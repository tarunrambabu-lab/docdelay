// Messages: a pretend outbox for updates — WhatsApp and text messages (SMS).
//
// When a patient's appointment time changes (rescheduled or pushed back), the
// hms module keeps ONE "pending update" for them with their latest time.
// Pressing "Send updates" turns the pending updates into sent messages.
// Nothing is really sent. Each sent update carries ONE channel label:
// "WhatsApp", "SMS", or "WhatsApp not delivered → sent by SMS" — never both.

import Link from "next/link";
import { connection } from "next/server";
import { getMessages, getPendingUpdates } from "@/hms/mockHms";
import type { Language } from "@/hms/types";
import { formatClock, formatTime, formatWhen } from "@/lib/time";
import { messageChannelLabel, type MessageChannelLabel } from "@/lib/whatsappStatus";
import { sendUpdatesAction } from "../actions";
import { TAP } from "../tapTarget";

const languageCodes: Record<Language, string> = { English: "en", Tamil: "ta", Hindi: "hi" };

// Colours for each channel label: WhatsApp green, SMS grey, fallback amber.
const channelColors: Record<MessageChannelLabel, string> = {
  WhatsApp: "bg-emerald-100 text-emerald-800",
  SMS: "bg-slate-100 text-slate-700",
  "WhatsApp not delivered → sent by SMS": "bg-amber-100 text-amber-900",
};

export default async function MessagesPage() {
  // Always read the latest messages when the page is opened. (Without this, a
  // production build would bake in whatever messages existed at build time.)
  await connection();

  const pending = await getPendingUpdates();
  const messages = await getMessages(); // newest first

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/" className={`text-sm font-medium text-teal-700 hover:underline ${TAP}`}>
        ← Back to dashboard
      </Link>
      <header className="mb-6 mt-3">
        <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
        <p className="text-sm text-slate-500">
          Simulated WhatsApp and text messages — nothing is actually sent.
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
                data-tour="send-updates"
                className={`rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 ${TAP}`}
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
              const first = u.appointment.timeHistory?.[0];
              // Show the day too when the patient moved to another day.
              const otherDay = first ? first.oldDayOffset !== u.newDayOffset : false;
              const show = (dayOffset: number, time: string) =>
                otherDay ? formatWhen(dayOffset, time) : formatTime(time);
              return (
                <li
                  key={u.appointmentId}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm"
                >
                  <p className="wrap-break-word">
                    <span className="font-medium text-slate-900">{patient.name}</span>{" "}
                    <span className="tabular-nums text-slate-500">{patient.phone}</span>{" "}
                    <span className="text-slate-400">· {patient.preferredLanguage}</span>
                  </p>
                  <p className="text-slate-600">
                    {first && <>was {show(first.oldDayOffset, first.oldStartTime)} → </>}
                    new time{" "}
                    <span className="font-semibold text-slate-900">
                      {show(u.newDayOffset, u.newStartTime)}
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
          {messages.map((m) => {
            const channel = messageChannelLabel(m);
            return (
              <li
                key={m.id}
                data-tour="sent-message"
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                  <p className="wrap-break-word">
                    <span className="font-medium text-slate-900">To: {m.toName}</span>{" "}
                    <span className="tabular-nums text-slate-500">{m.toPhone}</span>{" "}
                    <span className="text-slate-400">· {m.language}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Sent {formatClock(m.sentAt, { seconds: true })}
                  </p>
                </div>
                <p className="mb-2 text-xs">
                  <span
                    data-channel={channel}
                    className={`inline-block rounded-full px-2 py-0.5 font-medium ${channelColors[channel]}`}
                  >
                    {channel}
                  </span>
                  {m.whatsappFailed && (
                    <span className="ml-2 text-slate-500">
                      (a real system waits 15 minutes first)
                    </span>
                  )}
                </p>
                <p
                  lang={languageCodes[m.language]}
                  className="rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed wrap-break-word text-slate-800"
                >
                  {m.text}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
