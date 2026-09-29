// SAFETY CHECK on the AI's slot search: the patient named a weekday, so the
// AI must search that day.
//
// Basic mode reads the weekday names (English, Tamil, Hindi — see dayWords.ts).
// If the patient's message names a weekday and the AI's check_free_slots
// searches a DIFFERENT day (or today, or every day), DocDelay searches the
// patient's named weekday instead. claude.ts logs every correction.
//
// Not corrected when the message says what the patient does NOT want
// ("not Monday", "Thursday I'm busy", "somvar nahi"): then the named day is
// the one to avoid, and the AI's choice is kept.

import { namedWeekdayOffsets } from "./rules";

// Words that mean the named day is one to avoid.
const AVOIDING =
  /\b(not|no|never|except|cannot|can'?t|don'?t|won'?t|busy|other than|apart from|illa|illai|mudiyadhu|mudiyathu|mudiyaadhu|venam|vendam|vendaam|thavira|nahi|nahin|mat|chhodkar|chodkar)\b/i;

export function correctNamedDay(
  patientMessage: string,
  input: Record<string, unknown>,
): { input: Record<string, unknown>; correction?: string } {
  if (AVOIDING.test(patientMessage)) return { input };
  const named = namedWeekdayOffsets(patientMessage);
  if (named.length === 0) return { input };

  const days = Array.isArray(input.days) ? (input.days as unknown[]) : [];
  const searchesOnlyNamedDays =
    input.when === "other_days" &&
    days.length > 0 &&
    days.every((d) => typeof d === "number" && named.includes(d));
  if (searchesOnlyNamedDays) return { input };

  const searched = input.when === "today" ? "today" : days.length ? `days ${days.join(", ")}` : "every day";
  return {
    input: { ...input, when: "other_days", days: named },
    correction: `AI searched ${searched}; patient named day ${named.join(", ")} → searched that instead`,
  };
}
