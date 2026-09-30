// One AI chat message, from start to finish:
//   1. start an AI turn (the hms module gives it a private copy of the demo),
//   2. let Claude talk and use the tools (claude.ts),
//   3. CHECK the reply (not empty, not too long, only times the tools gave),
//   4. save it as one step — or report why not, so the caller can use the
//      rule-based stand-in for this message instead.
// Every AI message's token use and estimated cost is written to the server log.

import { startAiTurn } from "@/hms/mockHms";
import type { Language } from "@/hms/types";
import { MAX_AI_REPLY } from "@/hms/visitorState";
import { fromMinutes } from "@/lib/time";
import { AiTurnError, runClaudeTurn, type AiUsage } from "./claude";
import { AI_MODEL, AI_PRICE_PER_MILLION_TOKENS } from "./settings";

// Server log line, e.g.
// [DocDelay AI] appt-012 · 2 API calls · 3,120 in + 164 out tokens · ≈ $0.0039 · 2.4 s · booked
function logCost(appointmentId: string, usage: AiUsage, startedAt: number, result: string) {
  const dollars =
    (usage.inputTokens * AI_PRICE_PER_MILLION_TOKENS.input +
      usage.outputTokens * AI_PRICE_PER_MILLION_TOKENS.output) /
    1_000_000;
  console.log(
    `[DocDelay AI] ${appointmentId} · ${AI_MODEL} · ${usage.calls} API call${usage.calls === 1 ? "" : "s"} · ` +
      `${usage.inputTokens.toLocaleString("en-US")} in + ${usage.outputTokens.toLocaleString("en-US")} out tokens · ` +
      `≈ $${dollars.toFixed(4)} · ${((Date.now() - startedAt) / 1000).toFixed(1)} s · ${result}`,
  );
}

// Every clock time mentioned in a reply, as possible "HH:MM" values
// ("4:30 PM" → 16:30; "4:30" alone could be 04:30 or 16:30).
function timesIn(reply: string): string[][] {
  return [...reply.matchAll(/(\d{1,2})[:.](\d{2})\s*(AM|PM|am|pm)?/g)].map(([, h, m, ampm]) => {
    const hour = Number(h) % 12;
    const minutes = Number(m);
    if (ampm) return [fromMinutes((hour + (/pm/i.test(ampm) ? 12 : 0)) * 60 + minutes)];
    return [fromMinutes(hour * 60 + minutes), fromMinutes((hour + 12) * 60 + minutes)];
  });
}

// Every time must show AM/PM: in English "4:30 PM"; in Tamil and Hindi the
// full "மாலை 4:30 (4:30 PM)" form (the bracket holds the AM/PM time).
function missingAmPm(reply: string, language: Language): boolean {
  const withoutGood =
    language === "English"
      ? reply.replace(/\d{1,2}:\d{2}\s?(AM|PM)/gi, "")
      : reply.replace(/\d{1,2}:\d{2} \(\d{1,2}:\d{2} (AM|PM)\)/g, "");
  return /\d{1,2}:\d{2}/.test(withoutGood);
}

// Does the AI's reply ask the patient to repeat because it didn't understand?
// (Safety net: the AI is told to call cannot_understand instead, but doesn't
// always — so DocDelay spots it itself and counts it.)
const DID_NOT_UNDERSTAND =
  /(didn'?t|did not|couldn'?t|could not|don'?t|do not|wasn'?t able to)\s+(quite\s+)?(understand|catch|follow|get)|say (that|it) again|repeat (that|it)|समझ नहीं|समझ न|दोबारा|फिर से (कह|बोल|बता)|புரியவில்லை|புரியல|மீண்டும் (சொல்|கூற)|திரும்ப(ச்)? சொல்/i;

// Does the AI's reply say something is ALREADY booked, moved or confirmed?
// FRD rule: confirmations only ever use DocDelay's fixed wording. This is only
// checked when NO outcome was recorded in the message (with an outcome, the
// AI's text is never shown anyway) — so such a reply is never shown; the
// rule-based stand-in answers that message instead.
// Only "already done" forms: "booked", not "book"; "book ho gaya", not
// "book karna" (the AI asking "shall I book it?" is fine).
// ⚠️ The AI might still claim a booking in wording that isn't listed here —
// see BACKLOG.md. Tamil and Hindi to be reviewed by native speakers.
const CLAIMS_DONE: RegExp[] = [
  // English
  /\b(confirmed|booked|rescheduled|fixed|done|all sorted|all set|you'?re all set|your new (appointment|time)|has been (moved|changed)|i'?ve moved you|i have moved you|see you at)\b/i,
  // Tamil (script)
  /உறுதி ?செய்யப்பட்ட|உறுதிப்படுத்தப்பட்ட|பதிவு செய்யப்பட்ட|புக் செய்யப்பட்ட|புக் ஆகி|உங்கள் புதிய சந்திப்பு|உங்கள் புதிய நேரம்|மாற்றப்பட்டுள்ள|மாற்றப்பட்டது|ஃபிக்ஸ் பண்ணிட்ட|புக் பண்ணிட்ட|கன்ஃபர்ம் ஆச்சு|மாத்திட்ட/,
  // Tamil (English letters)
  /\b(uruthi ?seiyappatt|uruthippaduththappatt|padhivu seiyappatt|book aagi|book seiyappatt|ungal pudhiya sandhippu|ungal pudhiya neram|maatrappatt|fix pannitt|book pannitt|confirm aachu|confirm aagi|maathitt)/i,
  // Hindi (script)
  /पक्का हो|पक्की हो|कन्फ़?र्म हो|बुक हो (गया|गई|गयी|चुकी|चुका)|बुक कर (दी|दिया)|आपकी नई अपॉइंटमेंट|आपका नया समय|तय हो (गया|गई|गयी)|कर दिया|कर दी है|कर दी गई|फ़?िक्स कर दिया|हो गया है आपका|बदल (दी|दिया)/,
  // Hindi (English letters)
  /\b(pakka ho gay|pakki ho gay|confirm ho gay|book ho gay|book kar di|aapki nayi appointment|aapka naya samay|tay ho gay|kar diya|fix kar diya|ho gaya hai aapka)/i,
];

export function claimsDone(reply: string): boolean {
  return CLAIMS_DONE.some((words) => words.test(reply));
}

// Why a reply can't be used (or undefined if it's fine).
function problemWith(reply: string, allowed: Set<string>, language: Language): string | undefined {
  if (!reply) return "empty reply";
  if (reply.length > MAX_AI_REPLY) return `reply too long (${reply.length} characters)`;
  if (claimsDone(reply)) return "reply sounds like a confirmation, but nothing was booked";
  const unknown = timesIn(reply).find((options) => !options.some((t) => allowed.has(t)));
  if (unknown) return `reply mentions a time the tools didn't give (${unknown[0]})`;
  if (missingAmPm(reply, language)) return "reply has a time without AM/PM in the required form";
  return undefined;
}

export async function aiChatTurn(
  appointmentId: string,
  text: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const startedAt = Date.now();
  const turn = await startAiTurn(appointmentId);
  if (!turn) return { ok: false, reason: "patient is not waiting in a call" };

  try {
    const result = await runClaudeTurn(turn, text);
    const usage = result.usage;
    const reply = result.reply.replace(/\*\*/g, "").trim(); // plain text, no markdown bold
    // The AI asked the patient to repeat without calling cannot_understand:
    // treat it as "couldn't understand" anyway, so it's COUNTED here.
    let detected = false;
    if (!turn.outcome() && !turn.notUnderstood() && DID_NOT_UNDERSTAND.test(reply)) {
      turn.runTool("cannot_understand", {});
      detected = true;
    }
    const outcome = turn.outcome();
    // With an outcome or "couldn't understand", DocDelay's fixed line is used
    // (no AI text to check).
    const problem =
      outcome || turn.notUnderstood()
        ? undefined
        : problemWith(reply, turn.allowedTimes(), turn.context.language);
    if (problem) {
      logCost(appointmentId, usage, startedAt, `NOT USED — ${problem} → rule-based stand-in`);
      return { ok: false, reason: problem };
    }
    if (!(await turn.save(text, reply))) {
      logCost(appointmentId, usage, startedAt, "NOT SAVED → rule-based stand-in");
      return { ok: false, reason: "could not save the turn" };
    }
    logCost(
      appointmentId,
      usage,
      startedAt,
      (outcome ? outcome.kind : turn.notUnderstood() ? "couldn't understand" : "replied") +
        (detected ? " (spotted in the AI's reply, counted by DocDelay)" : ""),
    );
    return { ok: true };
  } catch (error) {
    const usage =
      error instanceof AiTurnError ? error.usage : { calls: 0, inputTokens: 0, outputTokens: 0 };
    const reason = error instanceof Error ? error.message : "unknown error";
    logCost(appointmentId, usage, startedAt, `FAILED — ${reason} → rule-based stand-in`);
    return { ok: false, reason };
  }
}
