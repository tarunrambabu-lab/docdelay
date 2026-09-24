// Messages: a pretend SMS outbox.
//
// When a patient's appointment time changes (rescheduled or pushed back), the
// hms module keeps ONE "pending update" for them with their latest time.
// Pressing "Send updates" turns the pending updates into sent messages.
// Nothing is really sent.

import Link from "next/link";
import { getMessages, getPendingUpdates } from "@/hms/mockHms";
import type { Language } from "@/hms/types";
import { formatTime } from "@/lib/time";
import { sendUpdatesAction } from "../actions";

const languageCodes: Record<Language, string> = { English: "en", Tamil: "ta", Hindi: "hi" };

export default async function MessagesPage() {
  const pending = await getPendingUpdates();
  const messages = await getMessages(); // newest first

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/" className="text-sm font-medium text-teal-700 hover:underline">
        ← Back to dashboard
      </Link>
      <header className="mb-6 mt-3">
        <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
        <p className="text-sm text-slate-500">
          Simulated text messages — nothing is actually sent.
        </p>
      </header>

      {/* ---------- Pending updates ---------- */}
      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">
            Pending updates <span className="font-normal text-slate-500">({pending.length})</span>
          </h2>
          {pending.length > 0 && (
            <form action={sendUpdatesAction}>
              <button
                type="submit"
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
              >
                Send updates
              </button>
            </form>
          )}
        </div>

        {pending.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Nothing waiting. Patients appear here when their appointment time changes.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-amber-200 bg-amber-50">
            {pending.map((u) => {
              const { patient } = u.appointment;
              const firstTime = u.appointment.timeHistory?.[0]?.oldStartTime;
              return (
                <li
                  key={u.appointmentId}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm"
                >
                  <p>
                    <span className="font-medium text-slate-900">{patient.name}</span>{" "}
                    <span className="tabular-nums text-slate-500">{patient.phone}</span>{" "}
                    <span className="text-slate-400">· {patient.preferredLanguage}</span>
                  </p>
                  <p className="text-slate-600">
                    {firstTime && <>was {formatTime(firstTime)} → </>}
                    new time{" "}
                    <span className="font-semibold text-slate-900">
                      {formatTime(u.newStartTime)}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------- Sent outbox ---------- */}
      <h2 className="mb-3 font-semibold text-slate-900">
        Sent <span className="font-normal text-slate-500">({messages.length}, newest first)</span>
      </h2>
      {messages.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          No messages sent yet.
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
                lang={languageCodes[m.language]}
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
