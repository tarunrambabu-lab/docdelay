// Front-desk dashboard (the home page).
//
// The chosen doctor lives in the web address, e.g. /?doctor=doc-ortho
// Clicking a doctor is just a link, so this page needs no browser-side code.

import Link from "next/link";
import {
  getDoctors,
  getHospital,
  getTodaysAppointments,
} from "@/hms/mockHms";
import type { Language } from "@/hms/types";

// Turn "13:45" into "1:45 PM".
function formatTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hours12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

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

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {/* Header */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-teal-700">DocDelay · Front desk</p>
          <h1 className="text-2xl font-semibold text-slate-900">{hospital.name}</h1>
          <p className="text-sm text-slate-500">{hospital.city}</p>
        </div>
        <p className="text-sm text-slate-600">{today}</p>
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
        <div className="flex items-baseline justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Today&apos;s appointments</h2>
          <p className="text-sm text-slate-500">{appointments.length} booked</p>
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
              {appointments.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-5 py-3 font-medium tabular-nums text-slate-900">
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
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {a.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
