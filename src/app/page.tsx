// Front-desk dashboard (the home page).
//
// The chosen doctor lives in the web address, e.g. /?doctor=doc-ortho
// Clicking a doctor is just a link. The only browser-side part is the
// "Mark doctor unavailable" pop-up (see MarkUnavailableButton.tsx).
// Each red banner links to the call simulator (app/calls/[id]/page.tsx).
// The header links to the simulated text messages (app/messages/page.tsx).

import Link from "next/link";
import {
  getAffectedAppointments,
  getDoctors,
  getHospital,
  getMessages,
  getTodaysAppointments,
  getUnavailabilities,
} from "@/hms/mockHms";
import type { Language } from "@/hms/types";
import { callSummary, statusColors } from "@/lib/status";
import { formatTime } from "@/lib/time";
import { resetDemoAction } from "./actions";
import MarkUnavailableButton from "./MarkUnavailableButton";

// A different colour for each language, so it's easy to scan.
const languageColors: Record<Language, string> = {
  English: "bg-sky-50 text-sky-700 ring-sky-200",
  Tamil: "bg-amber-50 text-amber-700 ring-amber-200",
  Hindi: "bg-violet-50 text-violet-700 ring-violet-200",
};

export default async function Home({ searchParams }: PageProps<"/">) {
  const hospital = await getHospital();
  const doctors = await getDoctors();

  // Which doctor is selected? Default to the first one.
  const { doctor } = await searchParams;
  const selected = doctors.find((d) => d.id === doctor) ?? doctors[0];
  const appointments = await getTodaysAppointments(selected.id);
  // Each unavailability, together with the appointments inside its window.
  const unavailabilities = await Promise.all(
    (await getUnavailabilities()).map(async (u) => ({
      ...u,
      appointments: await getAffectedAppointments(u.id),
    })),
  );
  const affectedCount = appointments.filter((a) => a.unavailabilityId).length;
  const messageCount = (await getMessages()).length;

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {/* Red banners: one for each time a doctor was marked unavailable */}
      {unavailabilities.length > 0 && (
        <div className="mb-6 space-y-2">
          {unavailabilities.map((u) => {
            const doctorName = doctors.find((d) => d.id === u.doctorId)?.name;
            const statuses = u.appointments.map((a) => a.status);
            const stillToCall = statuses.filter((s) => s === "Affected – needs contact").length;
            const summary = callSummary(statuses); // "" until someone is called
            return (
              <div
                key={u.id}
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-600 px-4 py-3 text-sm text-white shadow-sm"
              >
                <div>
                  <p className="font-medium">
                    {doctorName} unavailable from {formatTime(u.fromTime)} to{" "}
                    {formatTime(u.untilTime)} ({u.reason}). {u.affectedCount}{" "}
                    {u.affectedCount === 1 ? "patient" : "patients"} affected.
                  </p>
                  {summary && (
                    <p className="mt-0.5 text-red-100">
                      {summary}
                      {stillToCall > 0 && ` · ${stillToCall} still to call`}
                    </p>
                  )}
                </div>
                {stillToCall > 0 && (
                  <Link
                    href={`/calls/${u.id}`}
                    className="rounded-lg bg-white px-3 py-1.5 font-medium text-red-700 shadow-sm hover:bg-red-50"
                  >
                    Start calling patients
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Header */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-teal-700">DocDelay · Front desk</p>
          <h1 className="text-2xl font-semibold text-slate-900">{hospital.name}</h1>
          <p className="text-sm text-slate-500">{hospital.city}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-600">{today}</p>
          <Link
            href="/messages"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Messages{messageCount > 0 && ` (${messageCount})`}
          </Link>
          {/* Puts all appointments back to the starting data */}
          <form action={resetDemoAction}>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Reset demo
            </button>
          </form>
        </div>
      </header>

      {/* Doctor picker */}
      <h2 className="mb-3 text-sm font-medium text-slate-500">Choose a doctor</h2>
      <nav className="mb-8 grid gap-3 sm:grid-cols-3">
        {doctors.map((d) => {
          const isSelected = d.id === selected.id;
          return (
            <Link
              key={d.id}
              href={`/?doctor=${d.id}`}
              className={`rounded-xl border p-4 transition ${
                isSelected
                  ? "border-teal-600 bg-teal-50 ring-1 ring-teal-600"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
              }`}
            >
              <p className="font-medium text-slate-900">{d.name}</p>
              <p className="text-sm text-slate-500">{d.specialty}</p>
            </Link>
          );
        })}
      </nav>

      {/* Appointment list */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">Today&apos;s appointments</h2>
            <p className="text-sm text-slate-500">
              {appointments.length} booked
              {affectedCount > 0 && (
                <span className="text-red-600"> · {affectedCount} affected</span>
              )}
            </p>
          </div>
          <MarkUnavailableButton doctor={selected} />
        </div>

        {/* On small screens the table scrolls sideways instead of squashing. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Time</th>
                <th className="px-5 py-3 font-medium">Patient</th>
                <th className="px-5 py-3 font-medium">Reason</th>
                <th className="px-5 py-3 font-medium">Language</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {appointments.map((a) => {
                const affected = a.status === "Affected – needs contact";
                return (
                  <tr
                    key={a.id}
                    // Affected rows get a red tint and a red stripe on the left.
                    className={affected ? "bg-red-50" : "hover:bg-slate-50"}
                  >
                    <td
                      className={`whitespace-nowrap px-5 py-3 font-medium tabular-nums text-slate-900 ${
                        affected ? "shadow-[inset_4px_0_0_var(--color-red-500)]" : ""
                      }`}
                    >
                      {formatTime(a.startTime)}
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-slate-900">{a.patient.name}</p>
                      <p className="text-xs tabular-nums text-slate-500">{a.patient.phone}</p>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{a.reason}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ring-1 ${languageColors[a.patient.preferredLanguage]}`}
                      >
                        {a.patient.preferredLanguage}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[a.status]}`}
                      >
                        {a.status}
                      </span>
                      {/* If the time changed: first booked time → current time */}
                      {a.timeHistory && (
                        <p className="mt-1 whitespace-nowrap text-xs text-slate-500">
                          was {formatTime(a.timeHistory[0].oldStartTime)} → now{" "}
                          <span className="font-medium text-slate-800">
                            {formatTime(a.startTime)}
                          </span>
                        </p>
                      )}
                      {a.note && <p className="mt-1 text-xs text-orange-700">{a.note}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
