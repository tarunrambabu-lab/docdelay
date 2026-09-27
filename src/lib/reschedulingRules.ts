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
//   If the patient asked for a time today (e.g. "today, after 4"), the same
//   rules apply, but only at or after that time (and before it, for
//   "before 11"). If nothing fits: "no room today" — other days are offered.
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
//
// Any other day: EMPTY SLOTS ONLY. Nobody's booking on another day is ever
// moved or pushed. Every slot DocDelay mentions comes from listFreeSlots.

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
export const EVENING_STARTS = "16:00"; // from this on is "evening" (for chat requests like "evening")
export const DAYS_TO_SEARCH = 7; // how many days ahead to look for "another day" slots
export const OFFERS_TO_MAKE = 3; // how many other-day slots to offer

// ---------- Small helpers ----------

// Is the hospital closed on this day? (Today is always treated as open,
// so the demo works on any day.)
export function isClosedDay(dayOffset: number): boolean {
  return dayOffset > 0 && CLOSED_WEEKDAYS.includes(dateForDayOffset(dayOffset).getUTCDay());
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

// A patient's wished-for time as a window [from, until) in minutes.
function wishWindow(wish?: TimeWish): { from: number; until: number } {
  let from = -Infinity;
  let until = Infinity;
  if (wish?.after) from = Math.max(from, toMinutes(wish.after));
  if (wish?.before) until = Math.min(until, toMinutes(wish.before));
  if (wish?.timeOfDay === "morning") until = Math.min(until, toMinutes(MORNING_ENDS));
  if (wish?.timeOfDay === "afternoon") {
    from = Math.max(from, toMinutes(MORNING_ENDS));
    until = Math.min(until, toMinutes(EVENING_STARTS));
  }
  if (wish?.timeOfDay === "evening") from = Math.max(from, toMinutes(EVENING_STARTS));
  return { from, until };
}

export function planLaterToday(
  patientAppointment: Appointment,
  todaysAppointments: Appointment[], // ALL of this doctor's appointments TODAY
  returnTime: string, // the doctor's "Expected until" time
  wish?: TimeWish, // only if the patient asked for a time today, e.g. "after 4"
): LaterTodayPlan {
  const window = wishWindow(wish);
  // Cancelled appointments free up their slot; the patient's own old slot
  // (while the doctor was away) doesn't count either.
  const others = todaysAppointments.filter(
    (a) => a.id !== patientAppointment.id && a.status !== "Cancelled",
  );

  // Slots start on the quarter hour, so round the return time (or the
  // patient's wished-for time, if later) UP to one (e.g. 12:10 → 12:15).
  const firstSlot =
    Math.ceil(Math.max(toMinutes(returnTime), window.from) / SLOT_MINUTES) * SLOT_MINUTES;

  // Rule a: earliest empty slot between the return time and the end of the day
  // (or the end of the wished-for time).
  for (
    let slot = firstSlot;
    slot + SLOT_MINUTES <= Math.min(toMinutes(NORMAL_DAY_END), window.until);
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
  if (insertAt + SLOT_MINUTES > window.until) {
    return { kind: "no room", why: "nothing fits today at the time the patient asked for" };
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

// ---------- Free slots (used by "another day" and by chat) ----------

export type TimeOfDay = "morning" | "afternoon" | "evening";

// A time the patient asked for, without a day (e.g. "after 4", "evening").
export interface TimeWish {
  timeOfDay?: TimeOfDay;
  after?: string; // "HH:MM"
  before?: string; // "HH:MM"
}

// What to look for. Every field is optional.
export interface SlotQuery {
  days?: number[]; // which days (dayOffsets); default: every day from 1 to DAYS_TO_SEARCH
  timeOfDay?: TimeOfDay;
  after?: string; // "HH:MM" — the slot starts at or after this
  before?: string; // "HH:MM" — the slot ends at or before this
}

// "10:30" → "morning", "13:00" → "afternoon", "16:15" → "evening"
export function timeOfDayOf(time: string): TimeOfDay {
  const t = toMinutes(time);
  if (t < toMinutes(MORNING_ENDS)) return "morning";
  if (t < toMinutes(EVENING_STARTS)) return "afternoon";
  return "evening";
}

// Every genuinely EMPTY 15-minute slot that matches the query, earliest first.
// Only normal opening hours, never closed days, never beyond DAYS_TO_SEARCH.
// Today (day 0) is only searched if `todayFrom` says when the doctor is back.
// Nothing here ever needs anyone else to move.
export function listFreeSlots(
  doctorsAppointments: Appointment[], // ALL of this doctor's appointments, every day
  query: SlotQuery,
  options: { excludeAppointmentId?: string; todayFrom?: string } = {},
): SlotOffer[] {
  const days = query.days ?? Array.from({ length: DAYS_TO_SEARCH }, (_, i) => i + 1); // 1 … DAYS_TO_SEARCH
  const slots: SlotOffer[] = [];

  for (const day of [...new Set(days)].sort((a, b) => a - b)) {
    if (day < 0 || day > DAYS_TO_SEARCH || isClosedDay(day)) continue;
    if (day === 0 && !options.todayFrom) continue;

    const thatDay = doctorsAppointments.filter(
      (a) => a.dayOffset === day && a.id !== options.excludeAppointmentId,
    );
    const firstSlot =
      day === 0
        ? Math.max(
            toMinutes(DAY_START),
            Math.ceil(toMinutes(options.todayFrom!) / SLOT_MINUTES) * SLOT_MINUTES,
          )
        : toMinutes(DAY_START);

    for (
      let slot = firstSlot;
      slot + SLOT_MINUTES <= toMinutes(NORMAL_DAY_END);
      slot += SLOT_MINUTES
    ) {
      const time = fromMinutes(slot);
      if (query.timeOfDay && timeOfDayOf(time) !== query.timeOfDay) continue;
      if (query.after && slot < toMinutes(query.after)) continue;
      if (query.before && slot + SLOT_MINUTES > toMinutes(query.before)) continue;
      if (isSlotFree(thatDay, slot)) slots.push({ dayOffset: day, startTime: time });
    }
  }
  return slots;
}

// Pick up to `count` offers from a list of free slots: one per day, preferring
// the same half of the day as `anchorTime`, then the earliest days, then the
// time closest to `anchorTime`.
export function pickOffers(
  free: SlotOffer[],
  anchorTime: string,
  count = OFFERS_TO_MAKE,
): SlotOffer[] {
  const anchor = toMinutes(anchorTime);
  const morningEnds = toMinutes(MORNING_ENDS);
  const wantsMorning = anchor < morningEnds;

  // Of some free slots, the one closest to the anchor time
  // (the earlier one if two are equally close).
  const closest = (slots: number[]) =>
    [...slots].sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b)[0];

  const sameHalf: SlotOffer[] = []; // best slot per day in the same half of the day
  const otherHalf: SlotOffer[] = []; // best slot on days with nothing in the same half

  const days = [...new Set(free.map((s) => s.dayOffset))].sort((a, b) => a - b);
  for (const day of days) {
    const times = free.filter((s) => s.dayOffset === day).map((s) => toMinutes(s.startTime));
    const best = closest(times.filter((t) => t < morningEnds === wantsMorning));
    if (best !== undefined) {
      sameHalf.push({ dayOffset: day, startTime: fromMinutes(best) });
    } else if (times.length > 0) {
      otherHalf.push({ dayOffset: day, startTime: fromMinutes(closest(times)) });
    }
  }

  // Same half of the day first (earliest days), then fill up with the others.
  return [...sameHalf, ...otherHalf].slice(0, count).sort((a, b) => a.dayOffset - b.dayOffset);
}

// The `count` free slots closest to a wished-for day and time (any day if
// no day is given — then earlier days count as closer). Used when nothing
// matches exactly, or when the patient asked for one specific day.
export function pickClosest(
  free: SlotOffer[],
  target: { dayOffset?: number; time: string },
  count = OFFERS_TO_MAKE,
): SlotOffer[] {
  const distance = (s: SlotOffer) =>
    (target.dayOffset === undefined ? s.dayOffset : Math.abs(s.dayOffset - target.dayOffset)) *
      24 *
      60 +
    Math.abs(toMinutes(s.startTime) - toMinutes(target.time));
  return [...free]
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, count)
    .sort((a, b) => a.dayOffset - b.dayOffset || a.startTime.localeCompare(b.startTime));
}

// The time to search around for a chat request: "after 4" → 16:00,
// "before 11" → 10:00, "evening" → 16:30, … or else the original booking time.
export function anchorTime(
  wish: { timeOfDay?: TimeOfDay; after?: string; before?: string },
  originalTime: string,
): string {
  if (wish.after) return wish.after;
  if (wish.before) {
    return fromMinutes(Math.max(toMinutes(DAY_START), toMinutes(wish.before) - 60));
  }
  if (wish.timeOfDay)
    return { morning: "10:00", afternoon: "14:00", evening: "16:30" }[wish.timeOfDay];
  return originalTime;
}

// The time a patient was first booked for (exported for chat).
export function originalTimeOf(appt: Appointment): string {
  return originalStartTime(appt);
}

// ---------- "2 – Another day" ----------

// The 3 offers read out after "2 – Another day" (or "no room today").
export function findOtherDaySlots(
  patientAppointment: Appointment,
  doctorsAppointments: Appointment[], // ALL of this doctor's appointments, every day
): SlotOffer[] {
  const free = listFreeSlots(
    doctorsAppointments,
    {},
    {
      excludeAppointmentId: patientAppointment.id,
    },
  );
  return pickOffers(free, originalStartTime(patientAppointment));
}
