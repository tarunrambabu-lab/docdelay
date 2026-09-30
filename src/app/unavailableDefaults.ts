// The times "Mark doctor unavailable" starts with. Plain logic (no screen
// code), so it can be tested — see unavailableDefaults.test.ts.
//
//   - During the demo tour: always TOUR_UNAVAILABLE (9:00 AM – 12:00 PM).
//   - Otherwise: "From" = the clock's time now, rounded UP to the next
//     quarter-hour (e.g. 10:07 → 10:15); "Expected until" = 3 hours later.
//     With the demo clock (fixed at 9:00 AM) that's 9:00 AM – 12:00 PM.

import { CLOCK_MODE, hospitalTimeNow, type ClockMode } from "@/lib/clock";
import { fromMinutes, toMinutes } from "@/lib/time";
import { TOUR_UNAVAILABLE } from "./tour/tourSteps";

const LATEST_TIME = 23 * 60 + 45; // don't suggest times past 11:45 PM

// "From" time + 3 hours (but not past the end of the day).
export function threeHoursAfter(time: string): string {
  return fromMinutes(Math.min(toMinutes(time) + 3 * 60, LATEST_TIME));
}

export function defaultUnavailableTimes(
  inTour: boolean,
  mode: ClockMode = CLOCK_MODE,
): { fromTime: string; untilTime: string } {
  if (inTour) return { ...TOUR_UNAVAILABLE };
  const now = toMinutes(hospitalTimeNow(mode));
  const fromTime = fromMinutes(Math.min(Math.ceil(now / 15) * 15, LATEST_TIME));
  return { fromTime, untilTime: threeHoursAfter(fromTime) };
}
