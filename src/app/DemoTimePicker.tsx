"use client";

// The demo's clock on the dashboard: "Demo time: [9:00 AM ▾]".
// Demo only. Picking a later time saves it in this visitor's own demo (see
// setDemoTime in the hms module): nobody is moved and nothing is sent, but
// from then on no time today before it is offered or booked.
//   - Forward only: earlier times are greyed out. "Reset demo" goes back to 9:00 AM.
//   - Switched off while the guided tour runs, so a tour step can't be broken.
// "use client" means this part runs in the browser, because it reacts to the
// choice straight away.

import { useTransition } from "react";
import { formatTime } from "@/lib/time";
import { setDemoTimeAction } from "./actions";
import { DEMO_TIME_CHOICES } from "./demoTimes";
import { useTour } from "./tour/DemoTour";

export default function DemoTimePicker({ now }: { now: string }) {
  const { active: inTour } = useTour();
  const [pending, startSaving] = useTransition();

  return (
    <label
      title={
        inTour
          ? "The demo time can't be changed during the tour."
          : "Move the demo's clock forward to see what happens later in the day. “Reset demo” puts it back to 9:00 AM."
      }
      className="flex items-center gap-1.5 rounded-full bg-amber-100 py-0.5 pl-2.5 pr-1 text-xs font-medium text-amber-900"
    >
      Demo time:
      {/* The drop-down draws its own ▾, so it can be tall enough to tap on
          phones in every browser (Safari ignores the height of a plain one). */}
      <span className="relative inline-flex items-center">
        <select
          data-clock="picker"
          value={now}
          disabled={inTour || pending}
          onChange={(e) => {
            const time = e.target.value;
            startSaving(async () => {
              await setDemoTimeAction(time);
            });
          }}
          // 16 px text on phones, so iPhones don't zoom in; easy to tap.
          className="appearance-none rounded-full border border-amber-300 bg-white py-0.5 pl-2 pr-6 text-xs font-medium text-amber-950 disabled:opacity-60 max-sm:h-11 max-sm:text-base"
        >
          {DEMO_TIME_CHOICES.map((time) => (
            // Forward only: times before now can't be chosen.
            <option key={time} value={time} disabled={time < now}>
              {formatTime(time)}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="pointer-events-none absolute right-2 text-amber-900">
          ▾
        </span>
      </span>
    </label>
  );
}
