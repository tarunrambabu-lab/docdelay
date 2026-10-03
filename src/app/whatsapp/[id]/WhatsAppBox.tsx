"use client";

// The WhatsApp screen's reply area: you play the patient.
//   - The tap-list (see whatsappMenu.ts). There is NO "STOP" button: STOP only
//     works when it's typed.
//   - A box to type in the patient's own words (at most 200 characters).
//   - "Voice note (demo)": type what the patient SAYS; it's sent as a voice note.
//   - "Photo (demo)": sends a placeholder photo (DocDelay never reads photos).
// Everything goes to the hms module, which decides what happens.

import { useState, useTransition } from "react";
import { whatsappAction } from "@/app/actions";
import type { WhatsAppMedia } from "@/hms/types";
import type { TapList, TapOption } from "./whatsappMenu";

const MAX_LENGTH = 200; // same limit the server keeps

// Every button here is at least 44 px tall (min-h-11), on every screen size.
const smallButton =
  "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50";

// Markers for the guided tour (tour/tourSteps.ts, the WhatsApp step):
// "1 – Later today" on the menu, and the first time when times are offered.
function tourMarker(option: TapOption): string | undefined {
  if (option.label === "1 – Later today") return "whatsapp-later-today";
  if (option.send === "A") return "whatsapp-offer-pick";
  return undefined;
}

export default function WhatsAppBox({
  appointmentId,
  tapList,
}: {
  appointmentId: string;
  tapList: TapList; // the buttons to show right now (may be empty)
}) {
  const [text, setText] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false); // is the voice-note box showing?
  const [voiceText, setVoiceText] = useState("");
  const [notice, setNotice] = useState("");
  // isPending is true while a message is being handled, so it can't be sent twice.
  const [isPending, startTransition] = useTransition();

  // Send a message. `after` runs if it was sent (e.g. to empty the box).
  const send = (message: string, media?: WhatsAppMedia, after?: () => void) => {
    if (isPending || (media !== "photo" && !message.trim())) return;
    setNotice("");
    startTransition(async () => {
      const result = await whatsappAction(appointmentId, message, media);
      if (result?.notice) setNotice(result.notice);
      else after?.();
    });
  };

  return (
    <div className="grid gap-4">
      {/* The tap-list */}
      {tapList.options.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-500">{tapList.heading}</p>
          <div className="grid gap-2">
            {tapList.options.map((option) => (
              <button
                key={option.label}
                type="button"
                disabled={isPending}
                onClick={() => send(option.send)}
                data-tour={tourMarker(option)}
                className={`min-h-11 w-full rounded-lg border px-3 py-2 text-left text-sm font-medium wrap-break-word disabled:opacity-50 ${
                  option.unwell
                    ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Typing in the patient's own words */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text, undefined, () => setText(""));
        }}
        className="grid gap-2"
      >
        <label htmlFor="whatsapp-types" className="text-sm font-medium text-slate-500">
          The patient types…
        </label>
        <textarea
          id="whatsapp-types"
          rows={2}
          maxLength={MAX_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. “Can I come Thursday after 4?”"
          // max-sm:text-base = 16 px on phones, so iPhones don't zoom in when typing
          className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 max-sm:text-base"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">English, or Tamil / Hindi in English letters.</p>
          <button
            type="submit"
            disabled={isPending || !text.trim()}
            className="min-h-11 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {isPending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>

      {/* Voice note and photo (demo) */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          aria-expanded={voiceOpen}
          onClick={() => setVoiceOpen(!voiceOpen)}
          className={smallButton}
        >
          🎤 Voice note (demo)
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => send("", "photo")}
          className={smallButton}
        >
          📷 Photo (demo)
        </button>
      </div>
      {voiceOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(voiceText, "voice", () => {
              setVoiceText("");
              setVoiceOpen(false);
            });
          }}
          className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
        >
          <label htmlFor="whatsapp-says" className="text-sm font-medium text-slate-500">
            The patient says (sent as a voice note)…
          </label>
          <textarea
            id="whatsapp-says"
            rows={2}
            maxLength={MAX_LENGTH}
            value={voiceText}
            onChange={(e) => setVoiceText(e.target.value)}
            className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 max-sm:text-base"
          />
          <button
            type="submit"
            disabled={isPending || !voiceText.trim()}
            className="min-h-11 justify-self-end rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            Send voice note
          </button>
        </form>
      )}

      {notice && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm wrap-break-word text-amber-800">
          {notice}
        </p>
      )}
    </div>
  );
}
