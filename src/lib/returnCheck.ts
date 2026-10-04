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

type ReturnTimes = Pick<Unavailability, "untilTime" | "returnTimeChanges">;

// The return time that was entered first, "HH:MM".
export function firstExpectedReturn(unavailability: ReturnTimes): string {
  return unavailability.returnTimeChanges?.[0]?.oldTime ?? unavailability.untilTime;
}

// The earliest time today that a patient may be booked with this doctor — and
// the return time patients are told. Every booking rule reads THIS, never
// `untilTime` directly. ("HH:MM" text compares correctly: "12:00" < "14:00".)
export function bookingsStartAt(unavailability: ReturnTimes): string {
  const first = firstExpectedReturn(unavailability);
  return unavailability.untilTime > first ? unavailability.untilTime : first;
}

// Should the dashboard ask "is the doctor back?" — the expected return time
// has passed (`now` is the hospital's time, "HH:MM") and nobody has marked
// the doctor available. With the fixed demo clock (9:00 AM) this is never
// true by itself; the demo shows the check through a demo-only link.
export function isReturnCheckDue(
  unavailability: Pick<Unavailability, "untilTime" | "markedAvailableAt">,
  now: string,
): boolean {
  return !unavailability.markedAvailableAt && now >= unavailability.untilTime;
}

// The marker the "(Demo) Show the … check" link puts in the page address.
// It names the absence AND its current expected time, so the check goes away
// by itself once staff enter a new time. It only decides whether the check is
// SHOWN: it is never saved and never reaches the booking rules.
export function returnCheckCode(unavailability: Pick<Unavailability, "id" | "untilTime">): string {
  return `${unavailability.id}_${unavailability.untilTime.replace(":", "")}`;
}
