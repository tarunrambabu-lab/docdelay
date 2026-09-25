// RESCHEDULING RULES — how DocDelay finds new times for affected patients.
//
// This file only DECIDES. It looks at the doctor's appointments and returns a
// plan or a list of offers; it never saves anything. (The hms module applies
// the plan.) To change how rescheduling works, change this file.
//
// "1 – Later today", in order:
//   a. Use the earliest EMPTY 15-minute slot for that doctor at or after the
//      doctor's return time, up to the normal end of the day. Nobody else moves.
//   b. If there is no empty slot: put the patient at the return time — but
//      AFTER any patients already rescheduled there, so patients are placed in
//      the order they answer — and push every later appointment for that
//      doctor back by 15 minutes. The day may run past its normal end.
//   c. Don't push if that would make any appointment end after
//      LATEST_APPOINTMENT_END, or (fairness rule) make any UNAFFECTED patient
//      start more than MAX_PUSH_MINUTES after their original booked time.
//      Instead it's "no room today", and the patient is offered other days.
//
// "2 – Another day" (and "no room today"):
//   Offer OFFERS_TO_MAKE open slots with the same doctor over the next
//   DAYS_TO_SEARCH days, one per day, skipping closed days. Prefer the same
//   part of the day as the original booking (morning → morning,
//   afternoon → afternoon), then the earliest days, then the time closest to
//   the original.

import type { Appointment, SlotOffer } from "@/hms/types";
import { dateForDayOffset, formatTime, fromMinutes, toMinutes } from "@/lib/time";

// ---------- Hospital settings (change these to suit the hospital) ----------

export const SLOT_MINUTES = 15; // length of one appointment slot
export const DAY_START = "09:00"; // 9:00 AM — first slot of the day
export const NORMAL_DAY_END = "17:00"; // 5:00 PM — empty slots are only looked for before this
export const LATEST_APPOINTMENT_END = "19:00"; // 7:00 PM — no appointment may end later than this
export const MAX_PUSH_MINUTES = 45; // an unaffected patient may be pushed back at most this much in total
export const CLOSED_WEEKDAYS = [0]; // days the hospital is closed (0 = Sunday … 6 = Saturday)
export const MORNING_ENDS = "12:00"; // before this is "morning", from this on is "afternoon"
export const DAYS_TO_SEARCH = 7; // how many days ahead to look for "another day" slots
export const OFFERS_TO_MAKE = 3; // how many other-day slots to offer

// ---------- Small helpers ----------

// Is the hospital closed on this day? (Today is always treated as open,
// so the demo works on any day.)
export function isClosedDay(dayOffset: number): boolean {
  return dayOffset > 0 && CLOSED_WEEKDAYS.includes(dateForDayOffset(dayOffset).getDay());
}

// The time a patient was first booked for, before any changes.
function originalStartTime(appt: Appointment): string {
  return appt.timeHistory?.[0]?.oldStartTime ?? appt.startTime;
}

// Is this 15-minute slot free? `appointments` must be the doctor's
// appointments on that day; cancelled ones don't count.
export function isSlotFree(appointments: Appointment[], slotStart: number): boolean {
  return !appointments.some(
    (a) =>
      a.status !== "Cancelled" &&
      toMinutes(a.startTime) < slotStart + SLOT_MINUTES &&
      toMinutes(a.endTime) > slotStart,
  );
}

// ---------- "1 – Later today" ----------

export type LaterTodayPlan =
  // Rule a: an empty slot was found
  | { kind: "empty slot"; newStartTime: string }
  // Rule b: patient goes in at the return time (after earlier answerers);
  // these appointments move back
  | {
      kind: "push";
      newStartTime: string;
      pushed: { appointmentId: string; newStartTime: string }[];
    }
  // Rule c: no room today (why: which limit was hit)
  | { kind: "no room"; why: string };

export function planLaterToday(
  patientAppointment: Appointment,
  todaysAppointments: Appointment[], // ALL of this doctor's appointments TODAY
  returnTime: string, // the doctor's "Expected until" time
): LaterTodayPlan {
  // Cancelled appointments free up their slot; the patient's own old slot
  // (while the doctor was away) doesn't count either.
  const others = todaysAppointments.filter(
    (a) => a.id !== patientAppointment.id && a.status !== "Cancelled",
  );

  // Slots start on the quarter hour, so round the return time UP to one
  // (e.g. a return at 12:10 → first slot 12:15).
  const firstSlot = Math.ceil(toMinutes(returnTime) / SLOT_MINUTES) * SLOT_MINUTES;

  // Rule a: earliest empty slot between the return time and the end of the day.
  for (
    let slot = firstSlot;
    slot + SLOT_MINUTES <= toMinutes(NORMAL_DAY_END);
    slot += SLOT_MINUTES
  ) {
    if (isSlotFree(others, slot)) return { kind: "empty slot", newStartTime: fromMinutes(slot) };
  }

  // Rule b: no empty slot. Start at the return time, then step past patients
  // who already answered "later today" and were placed there (first come,
  // first served). The patient goes in the slot after them.
  let insertAt = firstSlot;
  while (
    others.some(
      (a) => toMinutes(a.startTime) === insertAt && a.status === "Rescheduled – later today",
    )
  ) {
    insertAt += SLOT_MINUTES;
  }

  // Everyone from that slot onwards moves back by one slot.
  const toPush = others.filter((a) => toMinutes(a.startTime) >= insertAt);
  const pushed = toPush.map((a) => ({
    appointmentId: a.id,
    newStartTime: fromMinutes(toMinutes(a.startTime) + SLOT_MINUTES),
  }));

  // Rule c, part 1: would anything (including the patient) now end too late?
  const latestEnd = Math.max(
    insertAt + SLOT_MINUTES,
    ...pushed.map((p) => toMinutes(p.newStartTime) + SLOT_MINUTES),
  );
  if (latestEnd > toMinutes(LATEST_APPOINTMENT_END)) {
    return { kind: "no room", why: `would run past ${formatTime(LATEST_APPOINTMENT_END)}` };
  }

  // Rule c, part 2 (fairness): would any UNAFFECTED patient — one who wasn't
  // hit by a doctor unavailability — end up more than MAX_PUSH_MINUTES after
  // their original booked time? (All pushes so far count together.)
  const unfair = toPush.some(
    (a) =>
      !a.unavailabilityId &&
      toMinutes(a.startTime) + SLOT_MINUTES - toMinutes(originalStartTime(a)) > MAX_PUSH_MINUTES,
  );
  if (unfair) {
    return {
      kind: "no room",
      why: `would push a patient more than ${MAX_PUSH_MINUTES} minutes past their booked time`,
    };
  }

  return { kind: "push", newStartTime: fromMinutes(insertAt), pushed };
}

// ---------- "2 – Another day" ----------

export function findOtherDaySlots(
  patientAppointment: Appointment,
  doctorsAppointments: Appointment[], // ALL of this doctor's appointments, every day
): SlotOffer[] {
  const original = toMinutes(originalStartTime(patientAppointment));
  const morningEnds = toMinutes(MORNING_ENDS);
  const wantsMorning = original < morningEnds;

  // Of a list of free slots, the one closest to the original time
  // (the earlier one if two are equally close).
  const closest = (slots: number[]) =>
    [...slots].sort((a, b) => Math.abs(a - original) - Math.abs(b - original) || a - b)[0];

  const sameHalf: SlotOffer[] = []; // best slot per day in the same half of the day
  const otherHalf: SlotOffer[] = []; // best slot on days with nothing in the same half

  for (let day = 1; day <= DAYS_TO_SEARCH; day++) {
    if (isClosedDay(day)) continue;
    const thatDay = doctorsAppointments.filter(
      (a) => a.dayOffset === day && a.id !== patientAppointment.id,
    );

    const free: number[] = [];
    for (
      let slot = toMinutes(DAY_START);
      slot + SLOT_MINUTES <= toMinutes(NORMAL_DAY_END);
      slot += SLOT_MINUTES
    ) {
      if (isSlotFree(thatDay, slot)) free.push(slot);
    }

    const best = closest(free.filter((s) => s < morningEnds === wantsMorning));
    if (best !== undefined) {
      sameHalf.push({ dayOffset: day, startTime: fromMinutes(best) });
    } else if (free.length > 0) {
      otherHalf.push({ dayOffset: day, startTime: fromMinutes(closest(free)) });
    }
  }

  // Same half of the day first (earliest days), then fill up with the others.
  return [...sameHalf, ...otherHalf]
    .slice(0, OFFERS_TO_MAKE)
    .sort((a, b) => a.dayOffset - b.dayOffset);
}
