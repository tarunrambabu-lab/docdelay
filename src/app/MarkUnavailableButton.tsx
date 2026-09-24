"use client";

// The "Mark doctor unavailable" button and the small pop-up form it opens.
// "use client" means this part runs in the browser, because it needs to
// open/close the pop-up and fill in times from the browser's clock.

import { useActionState, useState } from "react";
import { markUnavailableAction } from "./actions";
import { UNAVAILABILITY_REASONS, type Doctor } from "@/hms/types";
import { fromMinutes, toMinutes } from "@/lib/time";

const LATEST_TIME = 23 * 60 + 45; // don't suggest times past 11:45 PM

// Current time rounded UP to the next 15 minutes, e.g. 10:07 → 10:15.
function nextQuarterHour(): number {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return Math.min(Math.ceil(minutes / 15) * 15, LATEST_TIME);
}

// "From" time + 3 hours (but not past the end of the day).
function threeHoursAfter(time: string): string {
  return fromMinutes(Math.min(toMinutes(time) + 3 * 60, LATEST_TIME));
}

export default function MarkUnavailableButton({ doctor }: { doctor: Doctor }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700"
      >
        Mark doctor unavailable
      </button>
      {open && <UnavailableForm doctor={doctor} onClose={() => setOpen(false)} />}
    </>
  );
}

// The pop-up form. It's a separate component so it starts fresh
// (new default times, no old error message) every time it opens.
function UnavailableForm({ doctor, onClose }: { doctor: Doctor; onClose: () => void }) {
  const [fromTime, setFromTime] = useState(() => fromMinutes(nextQuarterHour()));
  const [untilTime, setUntilTime] = useState(() => threeHoursAfter(fromTime));
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

  const inputClass =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";

  return (
    // Dark see-through background behind the pop-up.
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        action={submit}
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
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

        <div className="mb-5 grid grid-cols-2 gap-3">
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
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Mark unavailable"}
          </button>
        </div>
      </form>
    </div>
  );
}
