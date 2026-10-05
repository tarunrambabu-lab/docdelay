// WHEN IS THE DOCTOR BACK? — small helpers for a doctor's absence
// (step 1 of the waiting check). Plain logic only: nothing here saves anything.
//
// Staff can change a doctor's expected return time, earlier or later. Three
// times matter, and they are easy to mix up:
//   - the CURRENT expected time (`untilTime`): what staff last entered. Shown
//     on the staff screens, and used for the "is the doctor back?" check.
//   - the FIRST expected time: what was entered when the doctor was marked
//     unavailable.
//   - the time BOOKINGS START AT: whichever of those two is LATER.
//
// The rule (agreed 4 Oct 2026): bookings never start earlier than the first
// expected return time. An earlier time, or an early "Mark doctor available",
// is shown and logged only — nothing changes for patients. A LATER time does
// make new bookings start later.

import type { Unavailability } from "@/hms/types";
import { fromMinutes, toMinutes } from "@/lib/time";

type ReturnTimes = Pick<Unavailability, "untilTime" | "returnTimeChanges">;

// The return time that was entered first, "HH:MM".
export function firstExpectedReturn(unavailability: ReturnTimes): string {
  return unavailability.returnTimeChanges?.[0]?.oldTime ?? unavailability.untilTime;
}

// When the doctor is back, as far as patients and bookings are concerned:
// the LATER of the first and the current expected return time. This is what
// patients are TOLD ("the doctor expects to be back around …"), and it never
// includes "now": at 1:07 PM a doctor expected at 12:00 is still "back at
// 12:00", not "back at 1:15". ("HH:MM" text compares correctly.)
export function doctorBackAt(unavailability: ReturnTimes): string {
  const first = firstExpectedReturn(unavailability);
  return unavailability.untilTime > first ? unavailability.untilTime : first;
}

// A time rounded UP to the next quarter hour — slots start on the quarter
// hour: "10:07" → "10:15"; "10:00" stays "10:00".
export function nextQuarterHour(time: string): string {
  return fromMinutes(Math.ceil(toMinutes(time) / 15) * 15);
}

// The earliest time today that a patient may be booked with this doctor.
// Every booking rule reads THIS, never `untilTime` directly.
//   - never before the doctor is back (doctorBackAt);
//   - never before NOW (`now` = the hospital's time, "HH:MM"), rounded up to
//     the next quarter hour: the "not before now" check. A slot that starts
//     exactly now can still be booked.
// (Without `now`, it's just when the doctor is back.)
export function bookingsStartAt(unavailability: ReturnTimes, now?: string): string {
  const back = doctorBackAt(unavailability);
  if (!now) return back;
  const soonest = nextQuarterHour(now);
  return soonest > back ? soonest : back;
}

// Should the dashboard ask "is the doctor back?" — the expected return time
// has passed (`now` is the hospital's time, "HH:MM") and nobody has marked
// the doctor available. In the demo it comes up by itself once the visitor
// moves the demo time to the expected return time or later.
export function isReturnCheckDue(
  unavailability: Pick<Unavailability, "untilTime" | "markedAvailableAt">,
  now: string,
): boolean {
  return !unavailability.markedAvailableAt && now >= unavailability.untilTime;
}
