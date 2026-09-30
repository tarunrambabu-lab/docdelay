// What the "understanding" layer turns a patient's chat message into.
// Every understanding engine (the rule-based stand-in today, Claude later)
// must return exactly this shape, so nothing else in the app changes when the
// engine is swapped.

import type { Language, SlotOffer } from "@/hms/types";
import type { TimeOfDay } from "@/lib/reschedulingRules";

export const INTENTS = [
  "later_today", // wait for a later slot today
  "another_day", // move to another day (maybe with preferences)
  "cancel",
  "talk_to_person",
  "choose_offer", // picked one of the offers read out (A/B/C, or named its day/time)
  "unclear",
  "health_concern", // ANY mention of a symptom or health worry → escalate to staff
  // A time but no day ("after 4") → ask "today, or another day?".
  // (Kept last so demos saved in visitors' cookies keep their meaning.)
  "time_without_day",
  // See a different doctor of the same specialty today ("another doctor",
  // "vera doctor", "doosre doctor", or "5"). Added after the others, for the
  // same reason.
  "another_doctor",
] as const;
export type Intent = (typeof INTENTS)[number];

// What the patient said they'd like. Every field is optional.
export interface Preferences {
  dayOffset?: number; // a specific day: 0 = today, 1 = tomorrow, … (from "Thursday", "tomorrow", "1st Oct")
  timeOfDay?: TimeOfDay; // "morning" | "afternoon" | "evening"
  after?: string; // "HH:MM" — e.g. "after 4" → "16:00"
  before?: string; // "HH:MM" — e.g. "before 11" → "11:00"
}

export interface Understanding {
  intent: Intent;
  preferences: Preferences;
  offerIndex?: number; // for choose_offer: 0 = A, 1 = B, 2 = C
}

// What the engine is told about the conversation so far.
export interface UnderstandingContext {
  language: Language; // the patient's preferred language
  offers: SlotOffer[]; // the offers the patient is looking at right now (may be empty)
}

// THE interface: one function. Every engine implements this.
export type Understander = (
  message: string,
  context: UnderstandingContext,
) => Promise<Understanding>;
