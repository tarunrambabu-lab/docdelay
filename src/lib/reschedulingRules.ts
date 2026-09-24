// RESCHEDULING RULES — what happens when a patient presses "1 – Later today".
//
// This file only DECIDES. It looks at the doctor's appointments and returns a
// plan; it never saves anything. (The hms module applies the plan.)
// To change how rescheduling works, change this file.
//
// The rules, in order:
//   a. Use the earliest EMPTY 15-minute slot for that doctor at or after the
//      doctor's return time, up to the normal end of the day. Nobody else moves.
//   b. If there is no empty slot: put the patient at the return time — but
//      AFTER any patients already rescheduled there, so patients are placed in
//      the order they answer — and push every later appointment for that
//      doctor back by 15 minutes. The day may run past its normal end.
//   c. Safety limit: if that push would make any appointment end after
//      LATEST_APPOINTMENT_END, don't push. The patient needs a staff call instead.

import type { Appointment } from "@/hms/types";
import { fromMinutes, toMinutes } from "@/lib/time";

// ---------- Hospital settings (change these to suit the hospital) ----------

export const SLOT_MINUTES = 15; // length of one appointment slot
export const NORMAL_DAY_END = "17:00"; // 5:00 PM — empty slots are only looked for before this
export const LATEST_APPOINTMENT_END = "19:00"; // 7:00 PM — no appointment may end later than this

// ---------- The plan this file hands back ----------

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
  // Rule c: no room today
  | { kind: "no room" };

export function planLaterToday(
  patientAppointment: Appointment,
  doctorsAppointments: Appointment[], // ALL of this doctor's appointments today
  returnTime: string, // the doctor's "Expected until" time
): LaterTodayPlan {
  // Cancelled appointments free up their slot; the patient's own old slot
  // (while the doctor was away) doesn't count either.
  const others = doctorsAppointments.filter(
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
    const taken = others.some(
      (a) => toMinutes(a.startTime) < slot + SLOT_MINUTES && toMinutes(a.endTime) > slot,
    );
    if (!taken) return { kind: "empty slot", newStartTime: fromMinutes(slot) };
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
  const pushed = others
    .filter((a) => toMinutes(a.startTime) >= insertAt)
    .map((a) => ({
      appointmentId: a.id,
      newStartTime: fromMinutes(toMinutes(a.startTime) + SLOT_MINUTES),
    }));

  // Rule c: would anything (including the patient) now end too late?
  const latestEnd = Math.max(
    insertAt + SLOT_MINUTES,
    ...pushed.map((p) => toMinutes(p.newStartTime) + SLOT_MINUTES),
  );
  if (latestEnd > toMinutes(LATEST_APPOINTMENT_END)) return { kind: "no room" };

  return { kind: "push", newStartTime: fromMinutes(insertAt), pushed };
}
