// DEMO ONLY: example replies shown as buttons in the call simulator's Chat
// mode, so demo visitors can try DocDelay without thinking what to type.
// Tapping one sends it exactly as if it had been typed.
//
// Only the simulator's chat box (ChatBox.tsx) may use this file — a test
// (demoPhrases.test.ts) fails if anything else imports it, so these can never
// end up in a real patient call, script or text message.
//
// `intent` = what DocDelay's basic (rule-based) mode must understand the phrase
// as; the tests check every phrase against it.
// Tamil and Hindi phrases: checked by native speaker.

import type { Language, SlotOffer } from "@/hms/types";
import { OFFER_LETTERS } from "@/lib/callScript";
import { formatWhen } from "@/lib/time";
import type { Intent } from "@/lib/understanding/types";

export interface DemoPhrase {
  text: string; // what the patient "says"
  meaning?: string; // short English meaning (Tamil and Hindi only)
  intent: Intent;
}

export const DEMO_PHRASES: Record<
  Language,
  { replies: DemoPhrase[]; symptom: DemoPhrase } // symptom = the one health example
> = {
  English: {
    replies: [
      { text: "I'll wait for a later time today", intent: "later_today" },
      { text: "Thursday after 4 PM", intent: "another_day" },
      { text: "Please cancel my appointment", intent: "cancel" },
      { text: "I want to talk to a person", intent: "talk_to_person" },
    ],
    symptom: { text: "I feel dizzy", intent: "health_concern" },
  },
  Tamil: {
    // checked by native speaker
    replies: [
      { text: "naan wait panren", meaning: "I'll wait", intent: "later_today" },
      { text: "Vyazhan 4 mani mela", meaning: "Thursday after 4", intent: "another_day" },
      { text: "cancel pannidunga", meaning: "Please cancel", intent: "cancel" },
      {
        text: "aal kitta pesanum",
        meaning: "I want to talk to a person",
        intent: "talk_to_person",
      },
    ],
    symptom: { text: "thala suthudhu", meaning: "I feel dizzy", intent: "health_concern" },
  },
  Hindi: {
    // checked by native speaker
    replies: [
      { text: "main ruk jaunga", meaning: "I'll wait", intent: "later_today" },
      { text: "guruvar 4 baje ke baad", meaning: "Thursday after 4", intent: "another_day" },
      { text: "cancel kar do", meaning: "Please cancel", intent: "cancel" },
      {
        text: "kisi se baat karni hai",
        meaning: "I want to talk to someone",
        intent: "talk_to_person",
      },
    ],
    symptom: {
      text: "mujhe chakkar aa raha hai",
      meaning: "I feel dizzy",
      intent: "health_concern",
    },
  },
};

// One pick button per offer on screen. The button shows the offer's time
// ("A · Thu 1 Oct, 4:00 PM"), but tapping it sends just the letter ("A"),
// like a patient would say it.
export function offerPicks(offers: SlotOffer[]): { send: string; label: string }[] {
  return offers.map((offer, i) => ({
    send: OFFER_LETTERS[i],
    label: `${OFFER_LETTERS[i]} · ${formatWhen(offer.dayOffset, offer.startTime)}`,
  }));
}
