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
//   Pushing (b, c) is ONLY for a plain "later today" / "I'll wait" with no time.
//
// A SPECIFIC time later today ("after 4", "evening", "today after 4"):
//   Only EMPTY slots at or after that time (and within it, e.g. "before 11"),
//   from the doctor's return time on, and ending by NORMAL_DAY_END (5:00 PM).
//   Slots after 5 PM are only ever created by pushing (a plain "later today"),
//   so e.g. "after 6" today finds nothing. Nobody is ever pushed to fit a
//   chosen time. If no empty slot fits, the patient is
//   told so and offered other days at that time. (emptySlotsToday below, and
//   the bookSlot check in the hms module, both follow this.)
//   The patient is offered up to OFFERS_TO_MAKE such slots (A/B/C) to pick from.
//   - If the asked time STARTS before the doctor's return (see wishStartsAt),
//     slots are offered from the return time — but never past the END of
//     the asked time (see wishEndsAt): "before 11" with the doctor back at
//     11:00 means nothing today, and other days before 11 are offered.
//   - If the asked time is outside clinic hours (see isOutsideClinicHours,
//     e.g. "after 6", "before 8"), the closest slots are offered, one per day.
//
// Other-day offers are one per day, earliest days first — EXCEPT when the
// patient names a day ("Monday afternoon"): then up to OFFERS_TO_MAKE slots
// on THAT day (see pickOnDay). Only if that day has nothing are the nearest
// other days offered, one per day (pickClosestPerDay with `aroundDay`).
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

// The free slots closest to a wished-for time, ONE PER DAY, earliest days
// first (like the other-day offers). Used when nothing matches exactly, or
// when the asked time is outside clinic hours.
// With `aroundDay`, the days NEAREST to that day come first instead (for
// "Thursday is full at that time").
export function pickClosestPerDay(
  free: SlotOffer[],
  time: string,
  count = OFFERS_TO_MAKE,
  aroundDay?: number,
): SlotOffer[] {
  const target = toMinutes(time);
  const closeness = (a: SlotOffer, b: SlotOffer) =>
    Math.abs(toMinutes(a.startTime) - target) - Math.abs(toMinutes(b.startTime) - target) ||
    a.startTime.localeCompare(b.startTime);
  const distance = (day: number) => (aroundDay === undefined ? day : Math.abs(day - aroundDay));
  const days = [...new Set(free.map((s) => s.dayOffset))].sort(
    (a, b) => distance(a) - distance(b) || a - b,
  );
  return days
    .slice(0, count)
    .map((day) => free.filter((s) => s.dayOffset === day).sort(closeness)[0])
    .sort((a, b) => a.dayOffset - b.dayOffset);
}

// Up to `count` free slots on ONE day (the one the patient named), closest to
// the wished-for time, shown in time order.
export function pickOnDay(free: SlotOffer[], time: string, count = OFFERS_TO_MAKE): SlotOffer[] {
  const target = toMinutes(time);
  return [...free]
    .sort(
      (a, b) =>
        Math.abs(toMinutes(a.startTime) - target) - Math.abs(toMinutes(b.startTime) - target) ||
        a.startTime.localeCompare(b.startTime),
    )
    .slice(0, count)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

// The earliest time a wish allows: "after 4" → 16:00, "afternoon" → 12:00,
// "evening" → 16:00; "before 11" (or nothing) → the start of the clinic day.
export function wishStartsAt(wish: TimeWish): string {
  if (wish.after) return wish.after;
  if (wish.timeOfDay === "afternoon") return MORNING_ENDS;
  if (wish.timeOfDay === "evening") return EVENING_STARTS;
  return DAY_START;
}

// The latest time a wish allows a slot to END: "before 11" → 11:00,
// "morning" → 12:00, "afternoon" → 16:00; undefined if it has no end.
export function wishEndsAt(wish: TimeWish): string | undefined {
  const ends = [
    wish.before,
    wish.timeOfDay === "morning" ? MORNING_ENDS : undefined,
    wish.timeOfDay === "afternoon" ? EVENING_STARTS : undefined,
  ].filter((t): t is string => t !== undefined);
  return ends.sort()[0];
}

// Is the asked time completely outside clinic hours (DAY_START–NORMAL_DAY_END,
// 9:00 AM–5:00 PM)? E.g. "after 6", "before 8" — no slot could ever fit.
export function isOutsideClinicHours(wish: TimeWish): boolean {
  let from = toMinutes(DAY_START);
  let until = toMinutes(NORMAL_DAY_END);
  if (wish.after) from = Math.max(from, toMinutes(wish.after));
  if (wish.before) until = Math.min(until, toMinutes(wish.before));
  if (wish.timeOfDay === "morning") until = Math.min(until, toMinutes(MORNING_ENDS));
  if (wish.timeOfDay === "afternoon") {
    from = Math.max(from, toMinutes(MORNING_ENDS));
    until = Math.min(until, toMinutes(EVENING_STARTS));
  }
  if (wish.timeOfDay === "evening") from = Math.max(from, toMinutes(EVENING_STARTS));
  return from + SLOT_MINUTES > until;
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

// A SPECIFIC time later today: the earliest `count` EMPTY slots at or after
// the time the patient asked for (from the doctor's return time on, ending by
// 5:00 PM). Never a push. With an empty `wish`: the earliest empty slots from
// the return time. Returns an empty list if nothing fits.
export function emptySlotsToday(
  doctorsAppointments: Appointment[], // this doctor's appointments
  returnTime: string, // the doctor's "Expected until" time
  wish: TimeWish,
  excludeAppointmentId?: string, // the patient's own (old) appointment
  count = OFFERS_TO_MAKE,
): SlotOffer[] {
  return listFreeSlots(
    doctorsAppointments,
    { days: [0], ...wish },
    { excludeAppointmentId, todayFrom: returnTime },
  ).slice(0, count);
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
