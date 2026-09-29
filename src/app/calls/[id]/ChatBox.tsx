"use client";

// Chat mode: where you type what the patient says.
// Above the box: example replies to tap (demo only — see demoPhrases.ts).
// A tapped phrase is sent exactly like a typed message.

import { useState, useTransition } from "react";
import { chatAction } from "@/app/actions";
import { TAP } from "@/app/tapTarget";
import type { Language } from "@/hms/types";
import { OFFER_LETTERS } from "@/lib/callScript";
import { DEMO_PHRASES } from "./demoPhrases";

const MAX_LENGTH = 200; // same limit the server keeps

export default function ChatBox({
  appointmentId,
  language,
  offerCount,
}: {
  appointmentId: string;
  language: Language; // the patient's language: which example phrases to show
  offerCount: number; // offers on screen right now (0 = none): one pick button each
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

  const { replies, symptom } = DEMO_PHRASES[language];
  // One pick per offer on screen: "A", "B" (and "C" when there are three).
  const offerPicks = OFFER_LETTERS.slice(0, offerCount).map((letter) => ({
    text: letter,
    meaning: `Pick offer ${letter}`,
  }));

  const phraseButton = (phrase: { text: string; meaning?: string }) => (
    <button
      key={phrase.text}
      type="button"
      disabled={isPending}
      onClick={() => send(phrase.text, false)}
      className="min-h-11 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm wrap-break-word text-slate-800 hover:bg-slate-100 disabled:opacity-50"
    >
      {phrase.text}
      {phrase.meaning && (
        <span className="block text-xs text-slate-500">{phrase.meaning}</span>
      )}
    </button>
  );

  return (
    <div className="grid gap-4">
      {/* Example replies to tap (demo only) */}
      <div>
        <p className="mb-2 text-sm font-medium text-slate-500">Try a reply (demo)</p>
        <div className="flex flex-wrap gap-2">
          {offerPicks.map(phraseButton)}
          {replies.map(phraseButton)}
        </div>
        <p className="mb-2 mt-3 text-xs font-medium text-slate-500">
          Example: patient mentions a symptom
        </p>
        <div className="flex flex-wrap gap-2">{phraseButton(symptom)}</div>
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
