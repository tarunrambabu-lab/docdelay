// Talking to Claude (the Anthropic API) for ONE patient chat message.
//
// Claude gets the instructions (aiInstructions.ts), the conversation so far
// and the tools below. The tools are run by the hms module (AiTurn.runTool)
// on a private copy of the visitor's demo, with all the hospital's rules.
// This file never saves anything — aiChat.ts checks the reply first.
//
// Uses the official Anthropic SDK. The API key comes from the
// ANTHROPIC_API_KEY environment variable (in .env.local on your laptop only).

import Anthropic from "@anthropic-ai/sdk";
import type { AiToolName, AiTurn } from "@/hms/mockHms";
import { AI_INSTRUCTIONS, aiContext } from "./aiInstructions";
import { correctNamedDay } from "./dayGuard";
import {
  AI_MAX_CALLS_PER_MESSAGE,
  AI_MAX_OUTPUT_TOKENS,
  AI_MODEL,
  AI_TIMEOUT_MS,
} from "./settings";

export interface AiUsage {
  calls: number; // API calls made for this message
  inputTokens: number;
  outputTokens: number;
}

// Thrown when the turn can't be finished; still reports what it cost.
export class AiTurnError extends Error {
  constructor(
    message: string,
    public usage: AiUsage,
  ) {
    super(message);
  }
}

const HHMM = { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" } as const;

// The tools, as Claude sees them. (What they DO is in the hms module.)
const TOOLS: (Anthropic.Tool & { name: AiToolName })[] = [
  {
    name: "check_free_slots",
    description:
      "Find real empty appointment slots with this patient's doctor, chosen by the hospital's rules. " +
      "Returns up to 3 slots (A/B/C) with the exact text to say, plus an explanation to follow.",
    input_schema: {
      type: "object",
      properties: {
        when: {
          type: "string",
          enum: ["today", "other_days"],
          description: "today = a later time today; other_days = another day",
        },
        days: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 7 },
          description:
            "Only for other_days: the day_offset numbers the patient asked for (from the calendar).",
        },
        time_of_day: { type: "string", enum: ["morning", "afternoon", "evening"] },
        after: { ...HHMM, description: "24-hour time, e.g. 16:00 for 'after 4'" },
        before: { ...HHMM, description: "24-hour time, e.g. 11:00 for 'before 11'" },
      },
      required: ["when"],
      additionalProperties: false,
    },
  },
  {
    name: "book_slot",
    description:
      "Book one slot the patient chose (it must come from check_free_slots). The hospital's rules are checked again; it may be refused.",
    input_schema: {
      type: "object",
      properties: {
        day_offset: { type: "integer", minimum: 0, maximum: 7 },
        start_time: HHMM,
      },
      required: ["day_offset", "start_time"],
      additionalProperties: false,
    },
  },
  {
    name: "wait_later_today",
    description:
      "The patient will simply wait for a later time today, with no particular time. The hospital's rules find the time (it may say there's no room today).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "cancel_appointment",
    description: "The patient wants to cancel the appointment.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "hand_to_staff",
    description: "A person from the front desk will call the patient back.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", enum: ["asked_for_person", "no_suitable_time"] },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  {
    name: "cannot_understand",
    description:
      "You could not understand the patient's message. Call ONLY this; DocDelay then asks the patient to say it again " +
      "(and after two in a row it hands them to staff itself). Not for normal clarifying questions.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "escalate_urgent",
    description:
      "The patient mentioned ANY health concern. Call this FIRST. Staff will call them now. Then reply with exactly the returned say_exactly text.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

// Long digit runs (like phone numbers) are removed before anything is sent.
const hideNumbers = (text: string) => text.replace(/\+?\d[\d\s-]{6,}\d/g, "[number removed]");

let client: Anthropic | undefined;

// Run one AI turn: returns Claude's final reply text and the token usage.
export async function runClaudeTurn(
  turn: AiTurn,
  patientMessage: string,
): Promise<{ reply: string; usage: AiUsage }> {
  client ??= new Anthropic({ maxRetries: 1 }); // reads ANTHROPIC_API_KEY
  const usage: AiUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const deadline = Date.now() + AI_TIMEOUT_MS;

  // The conversation so far: patient = "user", DocDelay = "assistant".
  const messages: Anthropic.MessageParam[] = [];
  for (const t of turn.context.history) {
    messages.push({
      role: t.from === "patient" ? "user" : "assistant",
      content: t.from === "patient" ? hideNumbers(t.text) : t.text,
    });
  }
  messages.push({ role: "user", content: hideNumbers(patientMessage) });
  while (messages[0]?.role === "assistant") messages.shift(); // must start with the patient

  for (let call = 0; call < AI_MAX_CALLS_PER_MESSAGE; call++) {
    const timeLeft = deadline - Date.now();
    if (timeLeft <= 0) throw new AiTurnError("timed out", usage);

    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        {
          model: AI_MODEL,
          max_tokens: AI_MAX_OUTPUT_TOKENS,
          system: `${AI_INSTRUCTIONS}\n\n${aiContext(turn.context)}`,
          tools: TOOLS,
          messages,
        },
        { timeout: timeLeft },
      );
    } catch (error) {
      const why =
        error instanceof Anthropic.APIError
          ? `API error ${error.status ?? ""} ${error.name}`
          : `request failed (${(error as Error).name})`;
      throw new AiTurnError(why, usage);
    }
    usage.calls++;
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    if (response.stop_reason === "end_turn") {
      const reply = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      return { reply, usage };
    }
    if (response.stop_reason !== "tool_use") {
      throw new AiTurnError(`stopped early (${response.stop_reason})`, usage);
    }

    // Run the tools Claude asked for, then send back the results.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const known = TOOLS.some((t) => t.name === block.name);
      let input = (block.input ?? {}) as Record<string, unknown>;
      // Safety check: if the patient named a weekday, search that day (dayGuard.ts).
      if (block.name === "check_free_slots") {
        const checked = correctNamedDay(patientMessage, input);
        if (checked.correction) console.log(`[DocDelay AI] day corrected: ${checked.correction}`);
        input = checked.input;
      }
      const result = known
        ? turn.runTool(block.name as AiToolName, input)
        : { ok: false, reason: `Unknown tool ${block.name}` };
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
        is_error: !known,
      });
    }
    // An outcome was recorded (booked, waiting, cancelled, staff, urgent), or
    // the AI said it couldn't understand: stop here — DocDelay sends its own
    // fixed line. (Saves a call.)
    if (turn.outcome() || turn.notUnderstood()) return { reply: "", usage };
    messages.push({ role: "user", content: results });
  }
  throw new AiTurnError(`no final reply after ${AI_MAX_CALLS_PER_MESSAGE} calls`, usage);
}
