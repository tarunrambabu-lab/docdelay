// Front-desk dashboard (the home page).
//
// The chosen doctor and day live in the web address, e.g.
// /?doctor=doc-ortho&day=2  (day 0 = today, 1 = tomorrow, …).
// Clicking a doctor or a day is just a link. The only browser-side part is the
// "Mark doctor unavailable" pop-up (see MarkUnavailableButton.tsx).
// Each red banner links to the call simulator (app/calls/[id]/page.tsx).
// The header links to the simulated text messages (app/messages/page.tsx).

import Link from "next/link";
import {
  getAffectedAppointments,
  getAppointmentsForDay,
  getAppointmentsMovedAwayFrom,
  getDoctors,
  getHospital,
  getMessages,
  getPendingUpdates,
  getUnavailabilities,
  isClosed,
} from "@/hms/mockHms";
import type { Language } from "@/hms/types";
import { DAYS_TO_SEARCH } from "@/lib/reschedulingRules";
import { callSummary, describeTimeChange, statusColors } from "@/lib/status";
import { formatDate, formatTime } from "@/lib/time";
import { resetDemoAction } from "./actions";
import MarkUnavailableButton from "./MarkUnavailableButton";

// A different colour for each language, so it's easy to scan.
const languageColors: Record<Language, string> = {
  English: "bg-sky-50 text-sky-700 ring-sky-200",
  Tamil: "bg-amber-50 text-amber-700 ring-amber-200",
  Hindi: "bg-violet-50 text-violet-700 ring-violet-200",
};

// Label for the day switcher: "Today", "Tomorrow", then "Mon 28 Sep".
function dayLabel(dayOffset: number): string {
  if (dayOffset === 0) return "Today";
  if (dayOffset === 1) return "Tomorrow";
  return formatDate(dayOffset);
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const hospital = await getHospital();
  const doctors = await getDoctors();

  // Which doctor and day are selected? Default to the first doctor, today.
  const { doctor, day } = await searchParams;
  const selected = doctors.find((d) => d.id === doctor) ?? doctors[0];
  const dayNumber = Number(day);
  const selectedDay =
    Number.isInteger(dayNumber) && dayNumber >= 0 && dayNumber <= DAYS_TO_SEARCH ? dayNumber : 0;
  const closed = await isClosed(selectedDay);
  const days = await Promise.all(
    Array.from({ length: DAYS_TO_SEARCH + 1 }, async (_, d) => ({ d, closed: await isClosed(d) })),
  );

  // This day's appointments, plus ones first booked on this day that have
  // since moved to another day (shown greyed out at their old time).
  const appointments = await getAppointmentsForDay(selected.id, selectedDay);
  const movedAway = await getAppointmentsMovedAwayFrom(selected.id, selectedDay);
  const rows = [
    ...appointments.map((a) => ({ a, movedAway: false, time: a.startTime })),
    ...movedAway.map((a) => ({ a, movedAway: true, time: a.timeHistory![0].oldStartTime })),
  ].sort((x, y) => x.time.localeCompare(y.time));

  // Each unavailability, together with the appointments it affected.
  const unavailabilities = await Promise.all(
    (await getUnavailabilities()).map(async (u) => ({
      ...u,
      appointments: await getAffectedAppointments(u.id),
    })),
  );
  // Affected by today's doctor unavailability — including patients who have
  // since moved to another day. (Only shown on the Today view.)
  const affectedCount = selectedDay === 0 ? rows.filter(({ a }) => a.unavailabilityId).length : 0;
  const messageCount = (await getMessages()).length;
  const pendingUpdates = await getPendingUpdates();

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
            // Texts for this doctor's patients that haven't been "sent" yet.
            const waiting = pendingUpdates.filter(
              (p) => p.appointment.doctorId === u.doctorId,
            ).length;
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
                  {waiting > 0 && (
                    <Link href="/messages" className="mt-0.5 block text-red-100 underline">
                      ✉ {waiting} {waiting === 1 ? "update" : "updates"} waiting to be sent
                    </Link>
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
      <nav className="mb-6 grid gap-3 sm:grid-cols-3">
        {doctors.map((d) => {
          const isSelected = d.id === selected.id;
          return (
            <Link
              key={d.id}
              href={`/?doctor=${d.id}&day=${selectedDay}`}
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

      {/* Day switcher */}
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Choose a day">
        {days.map(({ d, closed: isDayClosed }) =>
          isDayClosed ? (
            <span
              key={d}
              className="rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-400"
            >
              {dayLabel(d)} · Closed
            </span>
          ) : (
            <Link
              key={d}
              href={`/?doctor=${selected.id}&day=${d}`}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                d === selectedDay
                  ? "bg-teal-700 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {dayLabel(d)}
            </Link>
          ),
        )}
      </nav>

      {/* Appointment list */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">
              {selectedDay === 0
                ? "Today’s appointments"
                : `Appointments · ${dayLabel(selectedDay)}${selectedDay === 1 ? ` (${formatDate(1)})` : ""}`}
            </h2>
            <p className="text-sm text-slate-500">
              {closed ? "Closed" : `${appointments.length} booked`}
              {affectedCount > 0 && (
                <span className="text-red-600"> · {affectedCount} affected</span>
              )}
            </p>
          </div>
          {/* Doctors can only be marked unavailable for today */}
          {selectedDay === 0 && <MarkUnavailableButton doctor={selected} />}
        </div>

        {closed ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            The hospital is closed on this day.
          </p>
        ) : (
          // On small screens the table scrolls sideways instead of squashing.
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
                {rows.map(({ a, movedAway: gone, time }) => {
                  const affected = a.status === "Affected – needs contact";
                  return (
                    <tr
                      key={a.id}
                      // Affected rows get a red tint and a red stripe on the left.
                      // Rows that moved to another day are greyed out.
                      className={
                        affected ? "bg-red-50" : gone ? "bg-slate-50/70" : "hover:bg-slate-50"
                      }
                    >
                      <td
                        className={`whitespace-nowrap px-5 py-3 font-medium tabular-nums ${
                          gone ? "text-slate-400 line-through" : "text-slate-900"
                        } ${affected ? "shadow-[inset_4px_0_0_var(--color-red-500)]" : ""}`}
                      >
                        {formatTime(time)}
                      </td>
                      <td className="px-5 py-3">
                        <p className={gone ? "text-slate-500" : "text-slate-900"}>
                          {a.patient.name}
                        </p>
                        <p className="text-xs tabular-nums text-slate-500">{a.patient.phone}</p>
                      </td>
                      <td className={`px-5 py-3 ${gone ? "text-slate-400" : "text-slate-700"}`}>
                        {a.reason}
                      </td>
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
                          <p className="mt-1 whitespace-nowrap text-xs text-slate-600">
                            {describeTimeChange(a)}
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
        )}
      </section>
    </div>
  );
}
