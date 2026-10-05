"use client";

// The "Mark doctor unavailable" button and the small pop-up form it opens.
// "use client" means this part runs in the browser, because it needs to
// open/close the pop-up. The starting times come from the app's time now
// (`now` — in the demo, the visitor's demo time), not the browser's clock —
// see unavailableDefaults.ts.

import { useActionState, useState } from "react";
import { markUnavailableAction } from "./actions";
import { UNAVAILABILITY_REASONS, type Doctor } from "@/hms/types";
import { TAP } from "./tapTarget";
import { useTour } from "./tour/DemoTour";
import { defaultUnavailableTimes, threeHoursAfter } from "./unavailableDefaults";

export default function MarkUnavailableButton({ doctor, now }: { doctor: Doctor; now: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        data-tour="mark-unavailable"
        onClick={() => setOpen(true)}
        className={`rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 ${TAP}`}
      >
        Mark doctor unavailable
      </button>
      {open && <UnavailableForm doctor={doctor} now={now} onClose={() => setOpen(false)} />}
    </>
  );
}

// The pop-up form. It's a separate component so it starts fresh
// (new default times, no old error message) every time it opens.
function UnavailableForm({
  doctor,
  now,
  onClose,
}: {
  doctor: Doctor;
  now: string;
  onClose: () => void;
}) {
  // Starting times: from the time now (9:00 AM – 12:00 PM until the demo time
  // is moved, and always in the tour — see unavailableDefaults.ts).
  const { active: inTour } = useTour();
  const [defaults] = useState(() => defaultUnavailableTimes(inTour, now));
  const [fromTime, setFromTime] = useState(defaults.fromTime);
  const [untilTime, setUntilTime] = useState(defaults.untilTime);
  // Until the user edits "Expected until" themselves, keep it 3 hours after "From".
  const [untilEdited, setUntilEdited] = useState(false);

  // Send the form to the server; close the pop-up if it worked.
  const [result, submit, pending] = useActionState(
    async (previous: { ok?: boolean; error?: string }, formData: FormData) => {
      const response = await markUnavailableAction(previous, formData);
      if (response.ok) onClose();
      return response;
    },
    {},
  );

  // 16 px text on phones, so iPhones don't zoom in. On very narrow screens
  // (under 360 px) a little less padding, so "09:00 AM" fits in the time boxes.
  const inputClass =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 max-sm:text-base max-[360px]:px-2";

  return (
    // Dark see-through background behind the pop-up. During the guided tour
    // the pop-up is centred in the space ABOVE the tour card (the tour shares
    // its height as --tour-card-height), so the tour never hides its buttons.
    // If there isn't room, this area scrolls. (m-auto centres the pop-up and
    // still lets it scroll when it's taller than the space.)
    <div className="fixed inset-0 z-10 flex overflow-y-auto bg-slate-900/40 p-4 pb-[calc(var(--tour-card-height,0px)+1rem)] max-[360px]:px-3">
      <form
        action={submit}
        className="m-auto w-full max-w-sm rounded-xl bg-white p-6 shadow-xl max-[360px]:p-4"
      >
        <h2 className="text-lg font-semibold text-slate-900">Mark doctor unavailable</h2>
        <p className="mb-5 text-sm text-slate-500">
          {doctor.name} · {doctor.specialty}
        </p>

        <input type="hidden" name="doctorId" value={doctor.id} />

        <label className="mb-4 block text-sm font-medium text-slate-700">
          Reason
          <select name="reason" defaultValue={UNAVAILABILITY_REASONS[0]} className={inputClass}>
            {UNAVAILABILITY_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <div className="mb-5 grid grid-cols-2 gap-3 max-[360px]:gap-2">
          <label className="block text-sm font-medium text-slate-700">
            From
            <input
              type="time"
              name="fromTime"
              required
              value={fromTime}
              onChange={(e) => {
                setFromTime(e.target.value);
                if (!untilEdited && e.target.value) {
                  setUntilTime(threeHoursAfter(e.target.value));
                }
              }}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Expected until
            <input
              type="time"
              name="untilTime"
              required
              value={untilTime}
              onChange={(e) => {
                setUntilTime(e.target.value);
                setUntilEdited(true);
              }}
              className={inputClass}
            />
          </label>
        </div>

        {result.error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 ${TAP}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            data-tour="confirm-unavailable"
            disabled={pending}
            className={`rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60 ${TAP}`}
          >
            {pending ? "Saving…" : "Mark unavailable"}
          </button>
        </div>
      </form>
    </div>
  );
}
