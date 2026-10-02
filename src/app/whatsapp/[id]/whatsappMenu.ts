// The TAP-LIST on the WhatsApp screen: which buttons a patient sees right now,
// and what each button sends.
//
// Why this needs care: on WhatsApp a bare "1" means different things at
// different moments (see the "WhatsApp" section of hms/mockHms.ts):
//   - on the menu, "1" = later today;
//   - after an update ("Reply 1 to confirm, 2 to change"), "1" = keep it;
//   - after a heads-up to a pushed patient, "1" = that's fine.
// So the list is chosen from the appointment's state, and every button sends
// exactly what the hms module expects at that moment. Tapping a button is the
// same as typing what it sends — the hms module still decides everything.
//
// There is NO "STOP" button, on purpose: STOP only works when typed, so it
// can't be tapped by mistake. (A test checks this.)

import type { Appointment, Language, SlotOffer } from "@/hms/types";
import { OFFER_LETTERS } from "@/lib/callScript";
import { hospitalTimeNow } from "@/lib/clock";
import { formatClock, formatTime, formatWhen } from "@/lib/time";

// The time shown on a chat bubble — always from the app's clock (9:00 AM in
// the demo), never the computer's real time. A line with no saved time
// (DocDelay's first message, before the patient has replied) shows the
// clock's time now.
export const bubbleTime = (at: string) => (at ? formatClock(at) : formatTime(hospitalTimeNow()));

export interface TapOption {
  label: string; // what the button shows
  send: string; // what is sent when it's tapped
  unwell?: boolean; // the "I'm unwell" button (shown in red)
}

export interface TapList {
  heading: string; // a short line above the buttons
  options: TapOption[]; // empty = no tap-list right now (typing only)
}

// What "I'm unwell" sends, in the patient's language. Each sentence must be
// caught by the health check (a test makes sure), so it always goes URGENT.
export const UNWELL_MESSAGE: Record<Language, string> = {
  English: "I feel unwell",
  Tamil: "enakku udambu sari illai",
  Hindi: "meri tabiyat theek nahi hai",
};

// A finished answer (the same list as in the hms module).
const ANSWERED: Appointment["status"][] = [
  "Rescheduled – later today",
  "Rescheduled – another day",
  "Rebooked – another doctor",
  "Cancelled",
];

// One button per offer: "A · Thu 1 Oct, 4:00 PM" (plus the doctor's name for
// "another doctor today" offers). It sends just the letter.
function offerOptions(offers: SlotOffer[], doctorNames: string[]): TapOption[] {
  return offers.map((offer, i) => ({
    label:
      `${OFFER_LETTERS[i]} · ${formatWhen(offer.dayOffset, offer.startTime)}` +
      (doctorNames[i] ? ` · ${doctorNames[i]}` : ""),
    send: OFFER_LETTERS[i],
  }));
}

// The tap-list for one appointment.
//   anotherDoctorFree = can this patient be offered "5 – Another doctor"
//     right now? (The same check as the call: getAnotherDoctorOptions.)
//   doctorNames = one per offer on screen: the other doctor's name, or "".
export function tapListFor(
  appt: Appointment,
  language: Language,
  anotherDoctorFree: boolean,
  doctorNames: string[] = [],
): TapList {
  const unwell: TapOption = { label: "I’m unwell", send: UNWELL_MESSAGE[language], unwell: true };
  const none: TapList = { heading: "", options: [] };

  // The chat is closed, or the patient is already with staff: no tap-list.
  if (appt.whatsappStopped) return none;
  if (appt.status === "Needs staff call" || appt.status === "URGENT – staff call now") return none;

  // ----- A PUSHED patient (time moved, not affected): the heads-up replies -----
  if (!appt.unavailabilityId) {
    if (!appt.headsUpSent || appt.status !== "Time moved") return none;
    if (appt.headsUpCancelAsked) {
      return {
        heading: "Reply to “Reply YES to cancel”",
        options: [
          { label: "YES – cancel it", send: "YES" },
          { label: "No – keep it", send: "No" },
          unwell,
        ],
      };
    }
    return {
      heading: "Reply to the heads-up",
      options: [
        { label: "1 – That’s fine", send: "1" },
        { label: "2 – Cancel", send: "2" },
        { label: "3 – Talk to a person", send: "3" },
        unwell,
      ],
    };
  }

  const answered = ANSWERED.includes(appt.status);

  // ----- Offers on screen (A / B / C): pick one -----
  const offers = answered ? appt.change?.offers : appt.offers;
  if (offers?.length) {
    return {
      heading: "Pick a time",
      options: [
        ...offerOptions(offers, doctorNames),
        { label: "4 – Talk to a person", send: "4" },
        unwell,
      ],
    };
  }

  // ----- An update was sent: 1 keeps it, 2 shows the choices -----
  if (answered && appt.awaitingUpdateReply && !appt.change) {
    return {
      heading: "Reply to the update",
      options: [
        { label: "1 – Keep it", send: "1" },
        { label: "2 – Change", send: "2" },
        unwell,
      ],
    };
  }

  // ----- The menu: the same choices as the call -----
  return {
    heading: answered ? "Change the answer" : "The patient taps…",
    options: [
      { label: "1 – Later today", send: "1" },
      { label: "2 – Another day", send: "2" },
      { label: "3 – Cancel", send: "3" },
      { label: "4 – Talk to a person", send: "4" },
      // Only when an approved doctor has a free slot (the call's own check).
      ...(anotherDoctorFree ? [{ label: "5 – Another doctor today", send: "5" }] : []),
      unwell,
    ],
  };
}
