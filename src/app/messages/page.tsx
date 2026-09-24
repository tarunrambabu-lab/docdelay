// Messages: a pretend SMS outbox.
// Every time a patient's appointment time changes (rescheduled or pushed back),
// the hms module adds a text message here. Nothing is really sent.

import Link from "next/link";
import { getMessages } from "@/hms/mockHms";

export default async function MessagesPage() {
  const messages = await getMessages(); // newest first

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/" className="text-sm font-medium text-teal-700 hover:underline">
        ← Back to dashboard
      </Link>
      <header className="mb-6 mt-3">
        <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
        <p className="text-sm text-slate-500">
          Simulated text messages — nothing is actually sent. Newest first.
        </p>
      </header>

      {messages.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No messages yet. They appear when a patient&apos;s appointment time changes.
        </p>
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => (
            <li key={m.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                <p>
                  <span className="font-medium text-slate-900">To: {m.toName}</span>{" "}
                  <span className="tabular-nums text-slate-500">{m.toPhone}</span>{" "}
                  <span className="text-slate-400">· {m.language}</span>
                </p>
                <p className="text-xs text-slate-500">
                  Sent{" "}
                  {new Date(m.sentAt).toLocaleTimeString("en-IN", {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </p>
              </div>
              <p
                lang={{ English: "en", Tamil: "ta", Hindi: "hi" }[m.language]}
                className="rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-800"
              >
                {m.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
