// The ONE entry point for understanding a patient's chat message.
// Picks the engine from ./settings, applies the safety check and the
// spending limits, and never throws.

import { understandWithClaude } from "./claude";
import { mentionsHealth, understandWithRules } from "./rules";
import { UNDERSTANDING_ENGINE } from "./settings";
import type { Understanding, UnderstandingContext } from "./types";
import { countOneAiMessage } from "./usage";

export type { Understanding, UnderstandingContext } from "./types";

// Which engine is really in use: the AI only if it's chosen in settings AND
// an API key is set. Otherwise the free rule-based stand-in.
export function activeEngine(): "rules" | "claude" {
  return UNDERSTANDING_ENGINE === "claude" && process.env.ANTHROPIC_API_KEY ? "claude" : "rules";
}

export type InterpretResult =
  { ok: true; understanding: Understanding } | { ok: false; reason: "limit" | "error" }; // → switch to Buttons mode with a notice

export async function interpretPatientMessage(
  message: string,
  context: UnderstandingContext,
): Promise<InterpretResult> {
  // Safety first, whatever the engine: any health words → escalate at once
  // (and with the AI, this also avoids paying for a call).
  if (mentionsHealth(message)) {
    return { ok: true, understanding: { intent: "health_concern", preferences: {} } };
  }

  if (activeEngine() === "rules") {
    return { ok: true, understanding: await understandWithRules(message, context) };
  }

  // The AI engine: check the spending limits, then call it.
  if ((await countOneAiMessage()) !== "ok") return { ok: false, reason: "limit" };
  try {
    return { ok: true, understanding: await understandWithClaude(message, context) };
  } catch {
    return { ok: false, reason: "error" };
  }
}
