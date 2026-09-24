"use client";

// The buttons where you "play the patient" in the call simulator.
// Clicking one saves the answer, and the page moves on to the next patient.

import { useTransition } from "react";
import { recordCallAction } from "@/app/actions";
import type { CallResult } from "@/hms/types";

const answers: { label: string; result: CallResult; className: string }[] = [
  {
    label: "1 – Later today",
    result: "Wants later today",
    className: "bg-emerald-600 hover:bg-emerald-700 text-white",
  },
  {
    label: "2 – Another day",
    result: "Wants another day",
    className: "bg-blue-600 hover:bg-blue-700 text-white",
  },
  {
    label: "3 – Cancel",
    result: "Cancelled",
    className: "bg-zinc-700 hover:bg-zinc-800 text-white",
  },
  {
    label: "4 – Talk to a person",
    result: "Needs staff call",
    className: "bg-orange-500 hover:bg-orange-600 text-white",
  },
  {
    label: "Didn't pick up",
    result: "No answer",
    className: "border border-slate-300 bg-white hover:bg-slate-100 text-slate-700",
  },
];

export default function AnswerButtons({ appointmentId }: { appointmentId: string }) {
  // isPending is true while the answer is being saved, so buttons can't be
  // clicked twice.
  const [isPending, startTransition] = useTransition();

  return (
    <div className="grid gap-3">
      {answers.map((a) => (
        <button
          key={a.result}
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => recordCallAction(appointmentId, a.result))}
          className={`rounded-xl px-4 py-3 text-left text-sm font-medium shadow-sm transition disabled:opacity-50 ${a.className}`}
        >
          {a.label}
        </button>
      ))}
      {isPending && <p className="text-sm text-slate-500">Saving answer…</p>}
    </div>
  );
}
