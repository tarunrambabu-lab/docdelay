// The times "Mark doctor unavailable" starts with. Plain logic (no screen
// code), so it can be tested — see unavailableDefaults.test.ts.
//
//   - During the demo tour: always TOUR_UNAVAILABLE (9:00 AM – 12:00 PM).
//   - Otherwise: "From" = the time now (`now`, "HH:MM"), rounded UP to the
//     next quarter-hour (e.g. 10:07 → 10:15); "Expected until" = 3 hours later.
//     In the demo `now` is the visitor's demo time: 9:00 AM – 12:00 PM until
//     they move it (at 1:00 PM: 1:00 PM – 4:00 PM).

import { fromMinutes, toMinutes } from "@/lib/time";
import { TOUR_UNAVAILABLE } from "./tour/tourSteps";

const LATEST_TIME = 23 * 60 + 45; // don't suggest times past 11:45 PM

// "From" time + 3 hours (but not past the end of the day).
export function threeHoursAfter(time: string): string {
  return fromMinutes(Math.min(toMinutes(time) + 3 * 60, LATEST_TIME));
}

export function defaultUnavailableTimes(
  inTour: boolean,
  now: string, // the time now: the visitor's demo time, or the real hospital time
): { fromTime: string; untilTime: string } {
  if (inTour) return { ...TOUR_UNAVAILABLE };
  const fromTime = fromMinutes(Math.min(Math.ceil(toMinutes(now) / 15) * 15, LATEST_TIME));
  return { fromTime, untilTime: threeHoursAfter(fromTime) };
}
