// Front-desk dashboard (the home page).
//
// The chosen doctor and day live in the web address, e.g.
// /?doctor=doc-ortho&day=2  (day 0 = today, 1 = tomorrow, …).
// Clicking a doctor or a day is just a link. The only browser-side part is the
// "Mark doctor unavailable" pop-up (see MarkUnavailableButton.tsx).
// Each red banner links to the call simulator (app/calls/[id]/page.tsx).
// The header links to the simulated text messages (app/messages/page.tsx).
// At the very top: the staff call list — URGENT patients first.
// Clicking a patient's row opens their details (&appt=<id>): call log and chat.
// WhatsApp (simulated): small labels under each row's status, and an "Open
// WhatsApp" link for opted-in patients DocDelay has contacted (see
// lib/whatsappStatus.ts).

import Link from "next/link";
import {
  getAffectedAppointments,
  getInsideAbsence,
  getTimeNow,
  getAppointment,
  getAppointmentsForDay,
  getAppointmentsMovedAwayFrom,
  getDoctors,
  getHospital,
  getMessages,
  getPendingUpdates,
  getStaffCallList,
  getUnavailabilities,
  isClosed,
  isDemoNearlyFull,
} from "@/hms/mockHms";
import type { Language } from "@/hms/types";
import { DAYS_TO_SEARCH } from "@/lib/reschedulingRules";
import { callSummary, describeTimeChange, holdingLabel, statusColors } from "@/lib/status";
import { photoNote, whatsappRowInfo, type WhatsAppRowInfo } from "@/lib/whatsappStatus";
import {
  clockLabel,
  dateForDayOffset,
  formatDate,
  formatClock,
  formatTime,
  formatWhen,
} from "@/lib/time";
import { CLOCK_MODE } from "@/lib/clock";
import {
  bookingsStartAt,
  firstExpectedReturn,
  isReturnCheckDue,
} from "@/lib/returnCheck";
import { resetDemoAction } from "./actions";
import ClickableRow from "./ClickableRow";
import DemoTimePicker from "./DemoTimePicker";
import { isTimePassed } from "./demoTimes";
import FalseAlarmButton from "./FalseAlarmButton";
import MarkUnavailableButton from "./MarkUnavailableButton";
import PatientDetails from "./PatientDetails";
import { ChangeReturnTimeButton, MarkAvailableButton, StillAwayForm } from "./ReturnTimeControls";
import WhatsAppRowLink from "./WhatsAppRowLink";
import { TAP } from "./tapTarget";
import { TourStartButton } from "./tour/DemoTour";

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

// Background colour of a patient's row (laptop) or card (phone): URGENT is a
// stronger red, affected a light red, moved-to-another-day greyed out.
function rowTint(urgent: boolean, affected: boolean, gone: boolean): string {
  if (urgent) return "bg-red-100 hover:bg-red-200";
  if (affected) return "bg-red-50 hover:bg-red-100";
  if (gone) return "bg-slate-50/70 hover:bg-slate-100";
  return "hover:bg-slate-50";
}

// The red stripe on the left of affected (and URGENT) rows and cards.
function rowStripe(urgent: boolean, affected: boolean): string {
  if (urgent) return "shadow-[inset_4px_0_0_var(--color-red-700)]";
  if (affected) return "shadow-[inset_4px_0_0_var(--color-red-500)]";
  return "";
}

// WhatsApp labels under a row's status: small and muted, so the status badge
// (and URGENT) stays the most visible thing on the row. A photo note is a
// separate grey line: it never replaces the status or the orange note.
function WhatsAppLabels({ info }: { info: WhatsAppRowInfo }) {
  const line = [info.answeredBy, info.state].filter(Boolean).join(" · ");
  return (
    <>
      {info.okLabel && (
        <p className="mt-1">
          <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 ring-1 ring-emerald-200">
            WhatsApp OK
          </span>
        </p>
      )}
      {line && <p className="mt-1 text-xs text-slate-500">{line}</p>}
      {info.photos > 0 && (
        <p data-photo-note className="mt-1 text-xs text-slate-500">
          {photoNote(info.photos)}
        </p>
      )}
    </>
  );
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const hospital = await getHospital();
  const doctors = await getDoctors();

  // Which doctor and day are selected? Default to the first doctor, today.
  const { doctor, day, appt } = await searchParams;
  // The hospital's time now: in the demo, this visitor's demo time.
  const now = await getTimeNow();
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
      // After a LATER return time: patients whose time is now inside the absence.
      inside: await getInsideAbsence(u.id),
    })),
  );
  // Affected by today's doctor unavailability — including patients who have
  // since moved to another day. (Only shown on the Today view.)
  const affectedCount = selectedDay === 0 ? rows.filter(({ a }) => a.unavailabilityId).length : 0;
  const messages = await getMessages();
  const messageCount = messages.length;
  const pendingUpdates = await getPendingUpdates();
  const demoNearlyFull = await isDemoNearlyFull();
  const staffCalls = await getStaffCallList(); // URGENT first
  const here = `/?doctor=${selected.id}&day=${selectedDay}`; // this view, for links
  // A small grey "Time passed" label next to today's appointments whose time
  // is before now. A label only: no status changes, and the row keeps its
  // colour (a red "needs contact" patient still needs contact).
  const timePassed = (a: Parameters<typeof isTimePassed>[0], movedAway: boolean) =>
    selectedDay === 0 && !movedAway && isTimePassed(a, now);
  const opened = typeof appt === "string" ? await getAppointment(appt) : undefined;

  // Today's date in the hospital (from the clock), e.g. "Thursday, 1 October 2026".
  const today = dateForDayOffset(0).toLocaleDateString("en-IN", {
    timeZone: "UTC", // dateForDayOffset gives midnight UTC on the right date
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {/* Each visitor's demo is kept in a small cookie, which can fill up. */}
      {demoNearlyFull && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
          This demo has a lot of history. Press “Reset demo” to start fresh.
        </p>
      )}

      {/* Staff call list: URGENT patients first (bright red), then "Needs staff call" */}
      {staffCalls.length > 0 && (
        <section data-tour="staff-list" className="mb-6 rounded-xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
            Staff call list{" "}
            <span className="font-normal text-slate-500">({staffCalls.length})</span>
          </h2>
          <ul className="divide-y divide-slate-100">
            {staffCalls.map((c) => {
              const urgent = c.status === "URGENT – staff call now";
              return (
                <li
                  key={c.id}
                  className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm ${
                    urgent ? "bg-red-50" : ""
                  }`}
                >
                  <div>
                    <span
                      className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium max-sm:inline-block ${statusColors[c.status]}`}
                    >
                      {c.status}
                    </span>
                    {holdingLabel(c) && (
                      <span className="mr-2 text-xs font-medium text-orange-800">
                        · {holdingLabel(c)}
                      </span>
                    )}
                    <span className="font-medium wrap-break-word text-slate-900">
                      {c.patient.name}
                    </span>{" "}
                    <span className="whitespace-nowrap tabular-nums text-slate-500">{c.patient.phone}</span>
                    <p className="mt-0.5 text-xs wrap-break-word text-slate-500">
                      {c.doctorName} · {formatWhen(c.dayOffset, c.startTime)}
                      {c.note && ` · ${c.note}`}
                      {c.falseAlarms?.length ? ` · false alarms: ${c.falseAlarms.length}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {urgent && <FalseAlarmButton appointmentId={c.id} />}
                    <Link
                      href={`/?doctor=${c.doctorId}&day=${c.dayOffset}&appt=${c.id}`}
                      scroll={false}
                      className={`rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 ${TAP}`}
                    >
                      View
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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
            // ----- When is the doctor back? (waiting check, step 1) -----
            const first = firstExpectedReturn(u); // the time first entered
            const back = Boolean(u.markedAvailableAt);
            const changed = u.untilTime !== first;
            // The "is the doctor back?" check: comes up by itself once the
            // expected return time has passed (in the demo: once the visitor
            // moves the demo time that far).
            const checkShown = !back && isReturnCheckDue(u, now);
            const bannerButton = `rounded-lg border border-white/70 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 ${TAP}`;
            return (
              <div key={u.id} className="space-y-2">
                <div
                  role="alert"
                  data-tour="banner"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-600 px-4 py-3 text-sm text-white shadow-sm"
                >
                  <div>
                    <p className="font-medium">
                      {back ? (
                        <>
                          {doctorName} — back (marked available). Was away from{" "}
                          {formatTime(u.fromTime)} ({u.reason}).
                        </>
                      ) : changed ? (
                        <>
                          {doctorName} — away, expected back {formatTime(u.untilTime)} (was{" "}
                          {formatTime(first)}). Away from {formatTime(u.fromTime)} ({u.reason}).
                        </>
                      ) : (
                        <>
                          {doctorName} unavailable from {formatTime(u.fromTime)} to{" "}
                          {formatTime(u.untilTime)} ({u.reason}).
                        </>
                      )}{" "}
                      {u.affectedCount} {u.affectedCount === 1 ? "patient" : "patients"} affected.
                    </p>
                    {/* Early return: say clearly that nothing changes for patients. */}
                    {(back || u.untilTime < first) && (
                      <p data-return="note" className="mt-0.5 text-red-100">
                        Nothing changes for patients: new times today are still offered from{" "}
                        {formatTime(bookingsStartAt(u, now))}.
                      </p>
                    )}
                    {summary && (
                      <p className="mt-0.5 text-red-100">
                        {summary}
                        {stillToCall > 0 && ` · ${stillToCall} still to call`}
                      </p>
                    )}
                    {waiting > 0 && (
                      <Link
                        href="/messages"
                        className={`mt-0.5 block text-red-100 underline ${TAP}`}
                      >
                        ✉ {waiting} {waiting === 1 ? "update" : "updates"} waiting to be sent
                      </Link>
                    )}
                    {/* History: every change of the expected time, and "available". */}
                    {(u.returnTimeChanges || back) && (
                      <ul data-return="history" className="mt-1 text-xs text-red-100">
                        {u.returnTimeChanges?.map((c) => (
                          <li key={c.changedAt}>
                            {formatClock(c.changedAt)} · Expected back changed from{" "}
                            {formatTime(c.oldTime)} to {formatTime(c.newTime)}
                          </li>
                        ))}
                        {u.markedAvailableAt && (
                          <li>{formatClock(u.markedAvailableAt)} · Marked available by staff</li>
                        )}
                      </ul>
                    )}
                    {!back && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <ChangeReturnTimeButton
                          unavailabilityId={u.id}
                          doctorName={doctorName ?? ""}
                          untilTime={u.untilTime}
                          className={bannerButton}
                        />
                        <MarkAvailableButton
                          unavailabilityId={u.id}
                          doctorName={doctorName ?? ""}
                          className={bannerButton}
                        />
                      </div>
                    )}
                  </div>
                  {stillToCall > 0 && (
                    <Link
                      href={`/calls/${u.id}`}
                      data-tour="start-calling"
                      className={`rounded-lg bg-white px-3 py-1.5 font-medium text-red-700 shadow-sm hover:bg-red-50 ${TAP}`}
                    >
                      Start calling patients
                    </Link>
                  )}
                </div>

                {/* The system check: is the doctor back? */}
                {checkShown && (
                  <section
                    data-return="check"
                    className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm"
                  >
                    <p className="mb-3 font-medium">
                      {doctorName} was expected back at {formatTime(u.untilTime)}. Is the doctor
                      back?
                    </p>
                    <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                      <MarkAvailableButton
                        unavailabilityId={u.id}
                        doctorName={doctorName ?? ""}
                        className={`rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 ${TAP}`}
                      />
                      <StillAwayForm unavailabilityId={u.id} />
                    </div>
                  </section>
                )}

                {/* After a LATER return time: who is now booked while the doctor is away. */}
                {u.inside.length > 0 && (
                  <section
                    data-return="inside"
                    className="rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm shadow-sm"
                  >
                    <h2 className="font-semibold text-slate-900">
                      Times inside the longer absence — not contacted yet ({u.inside.length})
                    </h2>
                    <p className="mb-2 mt-0.5 text-slate-600">
                      {doctorName} is now expected back at {formatTime(u.untilTime)}. These patients
                      have a time before that. DocDelay has not told them: please call them.
                    </p>
                    <ul className="divide-y divide-slate-100">
                      {u.inside.map((row) => (
                        <li
                          key={`${row.appointment.id}-${row.group}`}
                          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5"
                        >
                          <span className="font-medium tabular-nums text-slate-900">
                            {formatTime(row.time)}
                          </span>
                          <span className="text-slate-900">{row.appointment.patient.name}</span>
                          <span className="whitespace-nowrap tabular-nums text-slate-500">
                            {row.appointment.patient.phone}
                          </span>
                          <span className="text-xs text-slate-500">{row.group}</span>
                          {row.unsentUpdate && (
                            <span className="text-xs font-medium text-amber-800">
                              ⚠ update not sent yet
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
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
          {/* The clock: in the demo, a picker the visitor can move FORWARD
              (each visitor's own demo); with the real clock, just the time. */}
          {CLOCK_MODE === "demo" ? (
            <DemoTimePicker now={now} />
          ) : (
            <p className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
              {clockLabel()}
            </p>
          )}
          <TourStartButton
            className={`rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 ${TAP}`}
          />
          <Link
            href="/messages"
            data-tour="messages-link"
            className={`rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 ${TAP}`}
          >
            Messages{messageCount > 0 && ` (${messageCount})`}
          </Link>
          {/* Puts all appointments back to the starting data */}
          <form action={resetDemoAction}>
            <button
              type="submit"
              className={`rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 ${TAP}`}
            >
              Reset demo
            </button>
          </form>
        </div>
      </header>

      {/* Doctor picker */}
      <h2 className="mb-3 text-sm font-medium text-slate-500">Choose a doctor</h2>
      <nav className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${TAP} ${
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
        <div
          data-tour="appointments"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"
        >
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
          {selectedDay === 0 && <MarkUnavailableButton doctor={selected} now={now} />}
        </div>

        {closed ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            The hospital is closed on this day.
          </p>
        ) : (
          <>
            {/* Phones (below 640 px): one card per patient instead of the table.
                Same colours, stripe and information; tap a card for details. */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {rows.map(({ a, movedAway: gone, time }) => {
                const affected = a.status === "Affected – needs contact";
                const urgent = a.status === "URGENT – staff call now";
                const whatsapp = whatsappRowInfo(a, messages);
                const holding = holdingLabel(a);
                return (
                  <li key={a.id}>
                    <Link
                      href={`${here}&appt=${a.id}`}
                      scroll={false}
                      className={`block px-4 py-3 text-sm ${rowTint(urgent, affected, gone)} ${rowStripe(urgent, affected)}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={`font-medium tabular-nums ${
                            gone ? "text-slate-400 line-through" : "text-slate-900"
                          }`}
                        >
                          {formatTime(time)}
                        </span>
                        {timePassed(a, gone) && (
                          <span data-time-passed className="mr-auto text-xs text-slate-500">
                            Time passed
                          </span>
                        )}
                        <span className="text-right">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[a.status]}`}
                          >
                            {a.status}
                          </span>
                          {holding && (
                            <span className="ml-1 text-xs font-medium text-orange-800">· {holding}</span>
                          )}
                        </span>
                      </div>
                      <p
                        className={`mt-1 font-medium wrap-break-word ${gone ? "text-slate-500" : "text-slate-900"}`}
                      >
                        {a.patient.name}{" "}
                        <span className="whitespace-nowrap text-xs font-normal tabular-nums text-slate-500">
                          {a.patient.phone}
                        </span>
                      </p>
                      <p className={`mt-1 wrap-break-word ${gone ? "text-slate-400" : "text-slate-700"}`}>
                        {a.reason}{" "}
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs ring-1 ${languageColors[a.patient.preferredLanguage]}`}
                        >
                          {a.patient.preferredLanguage}
                        </span>
                      </p>
                      {/* If the time changed: first booked time → current time */}
                      {a.timeHistory && (
                        <p className="mt-1 text-xs text-slate-600">{describeTimeChange(a, doctors)}</p>
                      )}
                      {a.note && (
                        <p className="mt-1 text-xs wrap-break-word text-orange-700">{a.note}</p>
                      )}
                      {a.falseAlarms?.length ? (
                        <p className="mt-1 text-xs text-slate-500">
                          False alarms: {a.falseAlarms.length}
                        </p>
                      ) : null}
                      <WhatsAppLabels info={whatsapp} />
                    </Link>
                    {/* Just below the card (a link can't sit inside the card's link) */}
                    {whatsapp.link && (
                      <div className={`-mt-2 px-3 pb-1 ${rowTint(urgent, affected, gone)} ${rowStripe(urgent, affected)}`}>
                        <WhatsAppRowLink appointmentId={a.id} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Laptops and tablets (640 px and wider): the table. */}
            <div className="hidden overflow-x-auto sm:block">
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
                    const urgent = a.status === "URGENT – staff call now";
                    const details = `${here}&appt=${a.id}`;
                    const whatsapp = whatsappRowInfo(a, messages);
                    const holding = holdingLabel(a);
                    return (
                      <ClickableRow
                        key={a.id}
                        href={details}
                        // Affected rows get a red tint and a red stripe on the left;
                        // URGENT rows a stronger red. Rows that moved to another day
                        // are greyed out. Click any row to see its details.
                        className={rowTint(urgent, affected, gone)}
                      >
                        <td
                          className={`whitespace-nowrap px-5 py-3 font-medium tabular-nums ${
                            gone ? "text-slate-400 line-through" : "text-slate-900"
                          } ${rowStripe(urgent, affected)}`}
                        >
                          {formatTime(time)}
                          {timePassed(a, gone) && (
                            <span data-time-passed className="block text-xs font-normal text-slate-500">
                              Time passed
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <Link
                            href={details}
                            scroll={false}
                            className={`hover:underline ${gone ? "text-slate-500" : "text-slate-900"}`}
                          >
                            {a.patient.name}
                          </Link>
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
                          {holding && (
                            <span className="ml-1 whitespace-nowrap text-xs font-medium text-orange-800">
                              · {holding}
                            </span>
                          )}
                          {/* If the time changed: first booked time → current time */}
                          {a.timeHistory && (
                            <p className="mt-1 whitespace-nowrap text-xs text-slate-600">
                              {describeTimeChange(a, doctors)}
                            </p>
                          )}
                          {a.note && <p className="mt-1 text-xs text-orange-700">{a.note}</p>}
                          {a.falseAlarms?.length ? (
                            <p className="mt-1 text-xs text-slate-500">
                              False alarms: {a.falseAlarms.length}
                            </p>
                          ) : null}
                          <WhatsAppLabels info={whatsapp} />
                          {whatsapp.link && <WhatsAppRowLink appointmentId={a.id} />}
                        </td>
                      </ClickableRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Patient details panel (opened by clicking a row) */}
      {opened && (
        <PatientDetails
          appointment={opened}
          doctorName={doctors.find((d) => d.id === opened.doctorId)?.name ?? ""}
          doctors={doctors}
          closeHref={here}
        />
      )}
    </div>
  );
}
