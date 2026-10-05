// Plain logic for the demo's clock on the dashboard (no screen code, so it
// can be tested — see hms/notBeforeNow.test.ts).

import { DEMO_LATEST_TIME, DEMO_TIME } from "@/lib/clock";
import { fromMinutes, toMinutes } from "@/lib/time";

// The demo time picker's choices: every quarter hour from 9:00 AM to 5:00 PM
// ("09:00", "09:15", … "17:00").
export const DEMO_TIME_CHOICES: string[] = [];
for (let m = toMinutes(DEMO_TIME); m <= toMinutes(DEMO_LATEST_TIME); m += 15) {
  DEMO_TIME_CHOICES.push(fromMinutes(m));
}

// Should a row on TODAY's list get the small grey "Time passed" label?
// Yes if the appointment starts before now. It's a label only: no status
// changes. An appointment starting exactly now hasn't passed; cancelled ones
// and ones that moved away from today get no label.
export function isTimePassed(
  appointment: { dayOffset: number; startTime: string; status: string },
  now: string,
): boolean {
  return (
    appointment.dayOffset === 0 &&
    appointment.status !== "Cancelled" &&
    appointment.startTime < now
  );
}
