// The panel that opens when you click a patient's row on the dashboard:
// status, time changes, the full call log and chat, and false alarms.
// (It's in the web address as &appt=<id>, so it can be linked and closed.)

import Link from "next/link";
import type { AppointmentWithPatient } from "@/hms/types";
import { describeTimeChange, statusColors } from "@/lib/status";
import { formatClock, formatWhen } from "@/lib/time";
import ChatTranscript from "./ChatTranscript";
import FalseAlarmButton from "./FalseAlarmButton";

export default function PatientDetails({
  appointment: a,
  doctorName,
  closeHref,
}: {
  appointment: AppointmentWithPatient;
  doctorName: string;
  closeHref: string;
}) {
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/40">
      {/* Clicking the dark background closes the panel */}
      <Link href={closeHref} scroll={false} aria-label="Close" className="flex-1" />
      <aside className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{a.patient.name}</h2>
            <p className="text-sm text-slate-500">
              {a.patient.phone} · {a.patient.preferredLanguage} · {doctorName}
            </p>
          </div>
          <Link
            href={closeHref}
            scroll={false}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            Close ✕
          </Link>
        </div>

        <section className="mb-6 space-y-2 text-sm">
          <p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[a.status]}`}
            >
              {a.status}
            </span>
          </p>
          <p className="text-slate-700">
            {formatWhen(a.dayOffset, a.startTime)} · {a.reason}
          </p>
          {a.timeHistory && <p className="text-slate-600">{describeTimeChange(a)}</p>}
          {a.note && <p className="text-orange-700">{a.note}</p>}
          {a.status === "URGENT – staff call now" && (
            <div className="rounded-lg bg-red-50 p-3">
              <p className="mb-2 font-medium text-red-700">
                A staff member must call this patient now. Nothing has been booked.
              </p>
              <FalseAlarmButton appointmentId={a.id} />
            </div>
          )}
        </section>

        {a.chat && a.chat.length > 0 && (
          <section className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Chat</h3>
            <ChatTranscript turns={a.chat} language={a.patient.preferredLanguage} />
          </section>
        )}

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Call log</h3>
          {a.callLog?.length ? (
            <ul className="space-y-1 text-sm text-slate-700">
              {a.callLog.map((entry, i) => (
                <li key={i}>
                  <span className="tabular-nums text-slate-500">{formatClock(entry.calledAt)}</span>{" "}
                  {entry.result && <strong className="font-medium">{entry.result}</strong>}
                  {entry.result && entry.detail && " — "}
                  {entry.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No calls yet.</p>
          )}
        </section>

        {a.timeHistory && (
          <section className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Time changes</h3>
            <ul className="space-y-1 text-sm text-slate-700">
              {a.timeHistory.map((change, i) => (
                <li key={i}>
                  <span className="tabular-nums text-slate-500">
                    {formatClock(change.changedAt)}
                  </span>{" "}
                  {formatWhen(change.oldDayOffset, change.oldStartTime)} →{" "}
                  {formatWhen(change.newDayOffset, change.newStartTime)} ({change.why})
                </li>
              ))}
            </ul>
          </section>
        )}

        {a.falseAlarms && a.falseAlarms.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">
              False alarms ({a.falseAlarms.length})
            </h3>
            <ul className="space-y-1 text-sm text-slate-700">
              {a.falseAlarms.map((alarm, i) => (
                <li key={i}>
                  Marked by {alarm.by} at {formatClock(alarm.at)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
