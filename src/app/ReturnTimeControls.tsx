"use client";

// Staff controls for a doctor's absence (step 1 of the waiting check):
//   - "Change expected return time": a small pop-up with one time box;
//   - "Mark doctor available": asks "is the doctor physically back?" first;
//   - "Still away: new expected time": the time box inside the
//     "is the doctor back?" check.
// "use client" means this part runs in the browser, because it opens and
// closes pop-ups. The saving itself happens on the server (see actions.ts).

import { useActionState, useState, useTransition } from "react";
import { changeReturnTimeAction, markAvailableAction, type ReturnTimeResult } from "./actions";
import { TAP } from "./tapTarget";

// 16 px text on phones, so iPhones don't zoom in (as in MarkUnavailableButton).
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 max-sm:text-base max-[360px]:px-2";

// The dark see-through background behind a pop-up, with the pop-up centred.
const overlayClass =
  "fixed inset-0 z-10 flex overflow-y-auto bg-slate-900/40 p-4 pb-[calc(var(--tour-card-height,0px)+1rem)] max-[360px]:px-3";
const popUpClass =
  "m-auto w-full max-w-sm rounded-xl bg-white p-6 text-left shadow-xl max-[360px]:p-4";

interface Absence {
  unavailabilityId: string;
  doctorName: string;
}

// ---------- Change expected return time ----------

export function ChangeReturnTimeButton({
  unavailabilityId,
  doctorName,
  untilTime, // the current expected return time, "HH:MM"
  className,
}: Absence & { untilTime: string; className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-return="change"
        onClick={() => setOpen(true)}
        className={className}
      >
        Change expected return time
      </button>
      {open && (
        <ChangeReturnTimeForm
          unavailabilityId={unavailabilityId}
          doctorName={doctorName}
          untilTime={untilTime}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// A separate component, so it starts fresh every time it opens.
function ChangeReturnTimeForm({
  unavailabilityId,
  doctorName,
  untilTime,
  onClose,
}: Absence & { untilTime: string; onClose: () => void }) {
  // Send the form to the server; close the pop-up if it worked.
  const [result, submit, pending] = useActionState(
    async (previous: ReturnTimeResult, formData: FormData) => {
      const response = await changeReturnTimeAction(previous, formData);
      if (response.ok) onClose();
      return response;
    },
    {},
  );

  return (
    <div className={overlayClass}>
      <form action={submit} className={popUpClass}>
        <h2 className="text-lg font-semibold text-slate-900">Change expected return time</h2>
        <p className="mb-4 text-sm text-slate-500">{doctorName}</p>
        <input type="hidden" name="unavailabilityId" value={unavailabilityId} />

        <label className="mb-3 block text-sm font-medium text-slate-700">
          Expected back at
          <input
            type="time"
            name="untilTime"
            required
            defaultValue={untilTime}
            className={`mt-1 w-full ${inputClass}`}
          />
        </label>
        <p className="mb-5 text-sm text-slate-500">
          This is recorded and shown here. No patient is moved and no message is sent.
        </p>

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
            data-return="save"
            disabled={pending}
            className={`rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60 ${TAP}`}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- Mark doctor available ----------

// Nothing is saved until staff answer the confirm question — a wrong press
// would stop the "is the doctor back?" check, and there is no undo.
export function MarkAvailableButton({
  unavailabilityId,
  doctorName,
  className,
}: Absence & { className: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startSaving] = useTransition();

  return (
    <>
      <button
        type="button"
        data-return="available"
        onClick={() => setOpen(true)}
        className={className}
      >
        Mark doctor available
      </button>
      {open && (
        <div className={overlayClass}>
          <div role="alertdialog" aria-modal="true" className={popUpClass}>
            <h2 className="text-lg font-semibold text-slate-900">
              Is {doctorName} physically back?
            </h2>
            <p className="mb-5 mt-2 text-sm text-slate-600">
              This ends the absence, and it can’t be undone. No patient is moved and no message is
              sent.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={`rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 ${TAP}`}
              >
                No, go back
              </button>
              <button
                type="button"
                data-return="confirm-available"
                disabled={pending}
                onClick={() =>
                  startSaving(async () => {
                    await markAvailableAction(unavailabilityId);
                    setOpen(false);
                  })
                }
                className={`rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60 ${TAP}`}
              >
                {pending ? "Saving…" : "Yes, mark available"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- "Still away: new expected time" (inside the check) ----------

export function StillAwayForm({ unavailabilityId }: { unavailabilityId: string }) {
  const [result, submit, pending] = useActionState(changeReturnTimeAction, {});
  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="unavailabilityId" value={unavailabilityId} />
      <input type="hidden" name="stillAway" value="1" />
      <label className="block text-sm font-medium text-amber-950">
        Still away: new expected time
        <input type="time" name="untilTime" required className={`mt-1 block ${inputClass}`} />
      </label>
      <button
        type="submit"
        data-return="still-away"
        disabled={pending}
        className={`rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-60 ${TAP}`}
      >
        {pending ? "Saving…" : "Save new time"}
      </button>
      {result.error && (
        <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
      )}
    </form>
  );
}
