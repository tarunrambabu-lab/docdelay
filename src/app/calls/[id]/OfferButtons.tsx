"use client";

// The buttons where you "play the patient" when they're offered other days:
// A / B / C (book that slot) or "None of these – call me".

import { useTransition } from "react";
import { chooseOfferAction } from "@/app/actions";
import type { SlotOffer } from "@/hms/types";
import { OFFER_LETTERS } from "@/lib/callScript";
import { formatWhen } from "@/lib/time";

export default function OfferButtons({
  appointmentId,
  offers,
}: {
  appointmentId: string;
  offers: SlotOffer[];
}) {
  // isPending is true while the choice is being saved, so buttons can't be
  // clicked twice.
  const [isPending, startTransition] = useTransition();
  const choose = (choice: number | null) =>
    startTransition(() => chooseOfferAction(appointmentId, choice));

  return (
    <div className="grid gap-3">
      {offers.map((offer, i) => (
        <button
          key={i}
          type="button"
          disabled={isPending}
          onClick={() => choose(i)}
          className="rounded-xl bg-blue-600 px-4 py-3 text-left text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
        >
          {OFFER_LETTERS[i]}
          <span className="ml-2 font-normal text-blue-100">
            {formatWhen(offer.dayOffset, offer.startTime)}
          </span>
        </button>
      ))}
      <button
        type="button"
        disabled={isPending}
        onClick={() => choose(null)}
        className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-50"
      >
        None of these – call me
      </button>
      {isPending && <p className="text-sm text-slate-500">Saving choice…</p>}
    </div>
  );
}
