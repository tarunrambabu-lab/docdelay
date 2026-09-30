"use client";

// Chat mode: where you type what the patient says.
// Above the box: example replies to tap (demo only — see demoPhrases.ts).
// A tapped phrase is sent exactly like a typed message.

import { useState, useTransition } from "react";
import { chatAction } from "@/app/actions";
import { TAP } from "@/app/tapTarget";
import type { Language, SlotOffer } from "@/hms/types";
import { DEMO_PHRASES, offerPicks } from "./demoPhrases";

const MAX_LENGTH = 200; // same limit the server keeps

export default function ChatBox({
  appointmentId,
  language,
  offers,
  doctorNames = [],
  anotherDoctorToday = false,
}: {
  appointmentId: string;
  language: Language; // the patient's language: which example phrases to show
  offers: SlotOffer[]; // offers on screen right now (none = empty): one pick button each
  doctorNames?: string[]; // one per offer: the other doctor's name, or "" (own doctor)
  anotherDoctorToday?: boolean; // show "I'd like to see another doctor today"?
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  // isPending is true while the message is being handled, so it can't be sent twice.
  const [isPending, startTransition] = useTransition();

  // Send a message. `fromBox` = it was typed, so empty the box afterwards.
  const send = (message: string, fromBox: boolean) => {
    if (!message.trim() || isPending) return;
    setError("");
    startTransition(async () => {
      const result = await chatAction(appointmentId, message);
      if (result?.error) setError(result.error);
      else if (fromBox) setText("");
    });
  };

  const { replies, symptom, anotherDoctor } = DEMO_PHRASES[language];

  // A button that sends `send`; it shows `label` (and a small English meaning).
  // `tour` = the marker the demo tour points at.
  const phraseButton = ({
    send: message,
    label,
    meaning,
    tour,
  }: {
    send: string;
    label: string;
    meaning?: string;
    tour?: string;
  }) => (
    <button
      key={message}
      type="button"
      data-tour={tour}
      disabled={isPending}
      onClick={() => send(message, false)}
      className="min-h-11 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm wrap-break-word text-slate-800 hover:bg-slate-100 disabled:opacity-50"
    >
      {label}
      {meaning && <span className="block text-xs text-slate-500">{meaning}</span>}
    </button>
  );
  const phrase = (p: { text: string; meaning?: string; intent: string }) =>
    phraseButton({
      send: p.text,
      label: p.text,
      meaning: p.meaning,
      tour: p.intent === "health_concern" ? "symptom-example" : `reply-${p.intent}`,
    });

  return (
    <div data-tour="chat-box" className="grid gap-4">
      {/* Example replies to tap (demo only) */}
      <div>
        <p className="mb-2 text-sm font-medium text-slate-500">Try a reply (demo)</p>
        <div className="flex flex-wrap gap-2">
          {/* "A · Thu 1 Oct, 4:00 PM" — sends just "A" */}
          {offerPicks(offers, doctorNames).map((pick) => phraseButton({ ...pick, tour: "offer-pick" }))}
          {replies.map(phrase)}
          {/* Only when an approved doctor has a free slot for this patient */}
          {anotherDoctorToday && phrase(anotherDoctor)}
        </div>
        <p className="mb-2 mt-3 text-xs font-medium text-slate-500">
          Example: patient mentions a symptom
        </p>
        <div className="flex flex-wrap gap-2">{phrase(symptom)}</div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text, true);
        }}
        className="grid gap-2"
      >
        <label htmlFor="patient-says" className="text-sm font-medium text-slate-500">
          The patient says…
        </label>
        <textarea
          id="patient-says"
          name="message"
          rows={3}
          maxLength={MAX_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a new line
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text, true);
            }
          }}
          placeholder="e.g. “Can I come Thursday after 4?”"
          // max-sm:text-base = 16 px on phones, so iPhones don't zoom in when typing
          className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 max-sm:text-base"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">English, or Tamil / Hindi in English letters.</p>
          <button
            type="submit"
            disabled={isPending || !text.trim()}
            className={`rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50 ${TAP}`}
          >
            {isPending ? "Sending…" : "Send"}
          </button>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </form>
    </div>
  );
}
