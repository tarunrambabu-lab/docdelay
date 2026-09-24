// Call simulator: goes through the affected patients of one
// "doctor unavailable" event, one by one, in appointment order.
// Address: /calls/<unavailability id>
//
// There's no "current patient" to remember: the next patient to call is
// simply the earliest one still marked "Affected – needs contact".
// When nobody is left, we show the summary.
//
// After a patient presses "1 – Later today", the address becomes
// /calls/<id>?answered=<appointment id>, and the phone card tells that
// patient their new time before moving on.

import Link from "next/link";
import {
  getAffectedAppointments,
  getAppointment,
  getDoctor,
  getHospital,
  getUnavailability,
} from "@/hms/mockHms";
import type { AppointmentWithPatient, Language } from "@/hms/types";
import { callScript, laterTodayReply } from "@/lib/callScript";
import { callSummary } from "@/lib/status";
import { formatTime } from "@/lib/time";
import AnswerButtons from "./AnswerButtons";

export default async function CallSimulator({ params, searchParams }: PageProps<"/calls/[id]">) {
  const { id } = await params;
  const { answered } = await searchParams;
  const unavailability = await getUnavailability(id);

  // E.g. after "Reset demo", old call lists no longer exist.
  if (!unavailability) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-16 text-center">
        <p className="mb-4 text-slate-600">This call list no longer exists.</p>
        <Link href="/" className="font-medium text-teal-700 hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const hospital = await getHospital();
  const doctor = (await getDoctor(unavailability.doctorId))!;
  const appointments = await getAffectedAppointments(id);
  const toCall = appointments.filter((a) => a.status === "Affected – needs contact");
  const current = toCall[0]; // undefined when everyone has been called
  const calledCount = appointments.length - toCall.length;
  const dashboardLink = `/?doctor=${doctor.id}`;

  // Did a patient just press "1 – Later today"? Then show them their answer.
  const justAnswered = typeof answered === "string" ? await getAppointment(answered) : undefined;
  const showReply =
    justAnswered?.unavailabilityId === id &&
    justAnswered.callLog?.at(-1)?.result === "Wants later today";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Link href={dashboardLink} className="text-sm font-medium text-teal-700 hover:underline">
        ← Back to dashboard
      </Link>
      <header className="mb-8 mt-3">
        <h1 className="text-2xl font-semibold text-slate-900">Call simulator</h1>
        <p className="text-sm text-slate-500">
          {doctor.name} · {unavailability.reason} · {formatTime(unavailability.fromTime)} to{" "}
          {formatTime(unavailability.untilTime)}
        </p>
      </header>

      {showReply ? (
        // ----- The patient pressed "1": tell them their new time -----
        <>
          <p className="mb-3 text-sm font-medium text-slate-500">
            Patient {calledCount} of {appointments.length}
          </p>
          <div className="grid gap-6 md:grid-cols-[1fr_320px]">
            <PhoneCard
              appointment={justAnswered}
              label="On call"
              message={laterTodayReply(
                justAnswered.patient.preferredLanguage,
                justAnswered.status === "Rescheduled – later today"
                  ? formatTime(justAnswered.startTime)
                  : null, // no room today
              )}
            />
            <div>
              <h2 className="mb-3 text-sm font-medium text-slate-500">
                The patient pressed “1 – Later today”
              </h2>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
                {justAnswered.status === "Rescheduled – later today" ? (
                  <p className="text-emerald-800">
                    Rescheduled: was {formatTime(justAnswered.timeHistory![0].oldStartTime)} → now{" "}
                    <strong>{formatTime(justAnswered.startTime)}</strong>
                  </p>
                ) : (
                  <p className="text-orange-800">
                    No room today. Status set to “Needs staff call”.
                  </p>
                )}
              </div>
              <Link
                href={`/calls/${id}`}
                className="block rounded-xl bg-teal-700 px-4 py-3 text-center text-sm font-medium text-white hover:bg-teal-800"
              >
                {current ? "Next patient →" : "See summary →"}
              </Link>
            </div>
          </div>
        </>
      ) : current ? (
        // ----- Calling the next patient -----
        <>
          <p className="mb-3 text-sm font-medium text-slate-500">
            Patient {calledCount + 1} of {appointments.length}
          </p>
          <div className="grid gap-6 md:grid-cols-[1fr_320px]">
            <PhoneCard
              appointment={current}
              label="Calling…"
              message={callScript({
                language: current.patient.preferredLanguage,
                patientName: current.patient.name,
                hospitalName: hospital.name,
                doctorName: doctor.name,
                reason: unavailability.reason,
                appointmentTime: formatTime(current.startTime),
                untilTime: formatTime(unavailability.untilTime),
              })}
            />
            {/* Right: you play the patient */}
            <div>
              <h2 className="mb-3 text-sm font-medium text-slate-500">The patient answers…</h2>
              {/* key = new buttons for each patient */}
              <AnswerButtons key={current.id} appointmentId={current.id} />
            </div>
          </div>
        </>
      ) : (
        // ----- Everyone has been called: show the summary -----
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-emerald-700">All patients contacted</p>
          <p className="mb-6 mt-2 text-xl font-semibold text-slate-900">
            {callSummary(appointments.map((a) => a.status)) || "No patients to call."}
          </p>
          <Link
            href={dashboardLink}
            className="inline-block rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Back to dashboard
          </Link>
        </div>
      )}
    </div>
  );
}

const languageCodes: Record<Language, string> = { English: "en", Tamil: "ta", Hindi: "hi" };

// The phone-style card: who's on the line, and what DocDelay says to them.
function PhoneCard({
  appointment,
  label,
  message,
}: {
  appointment: AppointmentWithPatient;
  label: string;
  message: string;
}) {
  const { patient } = appointment;
  // The time they were first booked for (before any changes).
  const originalTime = appointment.timeHistory?.[0]?.oldStartTime ?? appointment.startTime;

  return (
    <div className="rounded-[2rem] bg-slate-900 p-3 shadow-xl">
      <div className="rounded-[1.5rem] bg-slate-800 p-6 text-white">
        <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">● {label}</p>
        <p className="mt-2 text-2xl font-semibold">{patient.name}</p>
        <p className="tabular-nums text-slate-300">{patient.phone}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white/10 px-2 py-1">
            Language: {patient.preferredLanguage}
          </span>
          <span className="rounded-full bg-white/10 px-2 py-1">
            Appointment: {formatTime(originalTime)}
          </span>
        </div>

        <p className="mb-2 mt-6 text-xs font-medium uppercase tracking-wider text-slate-400">
          DocDelay says
        </p>
        <p
          lang={languageCodes[patient.preferredLanguage]}
          className="rounded-2xl rounded-tl-sm bg-white/10 p-4 leading-relaxed"
        >
          {message}
        </p>
      </div>
    </div>
  );
}
