"use client";

// Chat mode: where you type what the patient says.

import { useState, useTransition } from "react";
import { chatAction } from "@/app/actions";

const MAX_LENGTH = 200; // same limit the server keeps

export default function ChatBox({ appointmentId }: { appointmentId: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  // isPending is true while the message is being handled, so it can't be sent twice.
  const [isPending, startTransition] = useTransition();

  const send = () => {
    if (!text.trim() || isPending) return;
    setError("");
    startTransition(async () => {
      const result = await chatAction(appointmentId, text);
      if (result?.error) setError(result.error);
      else setText("");
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
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
            send();
          }
        }}
        placeholder="e.g. “Can I come Thursday after 4?”"
        className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">English, or Tamil / Hindi in English letters.</p>
        <button
          type="submit"
          disabled={isPending || !text.trim()}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {isPending ? "Sending…" : "Send"}
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}
