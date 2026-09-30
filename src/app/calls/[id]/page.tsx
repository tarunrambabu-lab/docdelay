// Call simulator: goes through the affected patients of one
// "doctor unavailable" event, one by one, in appointment order.
// Address: /calls/<unavailability id>
//
// There's no "current patient" to remember: the next patient to call is
// simply the earliest one still marked "Affected – needs contact".
// When nobody is left, we show the summary.
//
// Pressing "2 – Another day" (or "1" when there's no room today) keeps the
// same patient on screen with 3 other-day offers (A / B / C). Pressing
// "5 – Another doctor today" (Buttons only, shown only when an approved
// doctor has an empty slot) does the same with slots today with that doctor.
//
// When a patient gets a new time (later today, or an offer they picked), the
// address becomes /calls/<id>?answered=<appointment id>, and the phone card
// tells that patient their new time before moving on.
//
// Two modes (switch at the top, kept in the address as ?mode=chat):
//   - Buttons: you press what the patient answers.
//   - Chat: you type what the patient says; lib/understanding works out what
//     they mean, and the conversation goes on until an outcome is recorded.

import type { ReactNode } from "react";
import Link from "next/link";
import {
  getAffectedAppointments,
  getAnotherDoctorOptions,
  getAppointment,
  getDoctor,
  getDoctors,
  getHospital,
  getUnavailability,
} from "@/hms/mockHms";
import type { AppointmentWithPatient, Language } from "@/hms/types";
import {
  anotherDayReply,
  anotherDoctorOffersScript,
  anotherDoctorReply,
  callScript,
  laterTodayReply,
  otherDayOffersScript,
} from "@/lib/callScript";
import { slotTakenPrefix } from "@/lib/chatReplies";
import { callSummary, describeTimeChange, statusColors } from "@/lib/status";
import { formatTime } from "@/lib/time";
import { doctorNameFor } from "@/lib/names";
import { activeEngine } from "@/lib/understanding";
import ChatTranscript from "@/app/ChatTranscript";
import AnswerButtons from "./AnswerButtons";
import ChatBox from "./ChatBox";
import OfferButtons from "./OfferButtons";
import { TAP } from "@/app/tapTarget";

export default async function CallSimulator({ params, searchParams }: PageProps<"/calls/[id]">) {
  const { id } = await params;
  const { answered, mode: modeParam, notice } = await searchParams;
  const mode = modeParam === "chat" ? "chat" : "buttons";
  const unavailability = await getUnavailability(id);

  // E.g. after "Reset demo", old call lists no longer exist.
  if (!unavailability) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-16 text-center">
        <p className="mb-4 text-slate-600">This call list no longer exists.</p>
        <Link href="/" className={`font-medium text-teal-700 hover:underline ${TAP}`}>
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
  const doctors = await getDoctors();
  // A doctor's name as a patient hears it (e.g. "Dr. Karthik Raman", or with
  // the Tamil / Hindi spelling first).
  const nameFor = (doctorId: string | undefined, language: Language) => {
    const d = doctors.find((x) => x.id === doctorId);
    return d ? doctorNameFor(d, language) : "";
  };
  // Buttons only: can the current patient be offered "5 – Another doctor today"?
  const anotherDoctorToday =
    mode === "buttons" && current ? (await getAnotherDoctorOptions(current.id)).length > 0 : false;

  // Did a patient just get a new time? Then tell them.
  const justAnswered = typeof answered === "string" ? await getAppointment(answered) : undefined;
  const showReply =
    justAnswered?.unavailabilityId === id &&
    (justAnswered.status === "Rescheduled – later today" ||
      justAnswered.status === "Rescheduled – another day" ||
      justAnswered.status === "Rebooked – another doctor");
  // Chat mode: a conversation just ended with an outcome — show the whole chat.
  const chatDone =
    mode === "chat" &&
    justAnswered?.unavailabilityId === id &&
    justAnswered.status !== "Affected – needs contact";

  // What DocDelay says first to the current patient.
  const language = current?.patient.preferredLanguage ?? "English";
  const opening = current
    ? current.offers
      ? current.offersBecause === "another doctor"
        ? anotherDoctorOffersScript(
            language,
            current.offers.map((o) => ({
              startTime: o.startTime,
              doctorName: nameFor(o.doctorId, language),
            })),
          )
        : otherDayOffersScript(language, current.offers, current.offersBecause === "no room today")
      : callScript({
          language,
          patientName: current.patient.name,
          hospitalName: hospital.name,
          doctorName: doctorNameFor(doctor, language),
          reason: unavailability.reason,
          appointmentTime: current.startTime,
          untilTime: unavailability.untilTime,
          anotherDoctorToday,
        })
    : "";
  // Buttons: if the slot they picked with another doctor was just taken,
  // start with "Sorry, that time was just taken".
  const buttonsOpening = current?.slotJustTaken ? `${slotTakenPrefix(language)} ${opening}` : opening;
  const chatLabel =
    activeEngine() === "claude" ? "Chat (AI)" : "Chat (basic mode – AI coming soon)";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Link
        href={dashboardLink}
        data-tour="back-to-dashboard"
        className={`text-sm font-medium text-teal-700 hover:underline ${TAP}`}
      >
        ← Back to dashboard
      </Link>
      <header className="mb-8 mt-3">
        <h1 className="text-2xl font-semibold text-slate-900">Call simulator</h1>
        <p className="text-sm text-slate-500">
          {doctor.name} · {unavailability.reason} · {formatTime(unavailability.fromTime)} to{" "}
          {formatTime(unavailability.untilTime)}
        </p>
      </header>

      {/* Buttons / Chat switch */}
      <nav
        className="mb-6 inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 text-sm"
        aria-label="Mode"
      >
        {(
          [
            ["buttons", "Buttons", `/calls/${id}`],
            ["chat", chatLabel, `/calls/${id}?mode=chat`],
          ] as const
        ).map(([value, label, href]) => (
          <Link
            key={value}
            href={href}
            data-tour={value === "chat" ? "chat-tab" : undefined}
            aria-current={mode === value ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 font-medium ${TAP} ${
              mode === value ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Chat was switched off because of a spending limit or an AI error */}
      {mode === "buttons" && (notice === "limit" || notice === "error") && (
        <p className="mb-6 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Chat isn’t available right now
          {notice === "limit"
            ? " (today’s AI message limit was reached)"
            : " (the AI had a problem)"}
          , so the simulator switched to Buttons.
        </p>
      )}

      {chatDone ? (
        // ----- Chat mode: the conversation ended with an outcome -----
        <>
          <p className="mb-3 text-sm font-medium text-slate-500">
            Patient {calledCount} of {appointments.length}
          </p>
          <div className="grid gap-6 md:grid-cols-[1fr_320px]">
            <PhoneCard appointment={justAnswered} label="Chat ended">
              <ChatTranscript
                turns={justAnswered.chat ?? []}
                language={justAnswered.patient.preferredLanguage}
                dark
              />
            </PhoneCard>
            <div>
              <h2 className="mb-3 text-sm font-medium text-slate-500">Outcome</h2>
              <div
                data-tour="outcome"
                data-status={justAnswered.status}
                className="mb-4 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm"
              >
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[justAnswered.status]}`}
                >
                  {justAnswered.status}
                </span>
                {justAnswered.status === "URGENT – staff call now" && (
                  <p className="font-medium text-red-700">
                    A staff member must call this patient now. Nothing was booked.
                  </p>
                )}
                {justAnswered.note && <p className="wrap-break-word text-orange-800">{justAnswered.note}</p>}
                {justAnswered.timeHistory && (
                  <p className="text-emerald-800">{describeTimeChange(justAnswered, doctors)}</p>
                )}
              </div>
              <Link
                href={`/calls/${id}?mode=chat`}
                data-tour="next-patient"
                className="block rounded-xl bg-teal-700 px-4 py-3 text-center text-sm font-medium text-white hover:bg-teal-800"
              >
                {current ? "Next patient →" : "See summary →"}
              </Link>
            </div>
          </div>
        </>
      ) : mode === "chat" && current?.offersBecause === "another doctor" ? (
        // ----- Chat mode, but this patient is choosing another doctor (Buttons only) -----
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <p className="mb-3">
            {current.patient.name} pressed “5 – Another doctor today” and is choosing a time. That
            choice is only available in Buttons mode.
          </p>
          <Link href={`/calls/${id}`} className={`font-medium text-teal-700 hover:underline ${TAP}`}>
            Continue in Buttons →
          </Link>
        </div>
      ) : mode === "chat" && current ? (
        // ----- Chat mode: talking to the current patient -----
        <>
          <p className="mb-3 text-sm font-medium text-slate-500">
            Patient {calledCount + 1} of {appointments.length}
          </p>
          <div className="grid gap-6 md:grid-cols-[1fr_320px]">
            <PhoneCard appointment={current} label="On call (chat)">
              <ChatTranscript
                turns={current.chat ?? [{ at: "", from: "docdelay", text: opening }]}
                language={current.patient.preferredLanguage}
                dark
              />
            </PhoneCard>
            <div>
              {/* key = a fresh, empty box for each patient */}
              <ChatBox
                key={current.id}
                appointmentId={current.id}
                language={current.patient.preferredLanguage}
                offers={current.offers ?? []}
              />
              <p className="mt-4 text-xs leading-relaxed text-slate-500">
                The chat goes on until an outcome is recorded: later today, another day, cancel, or
                a staff call. Any mention of a health concern hands the patient straight to staff.
              </p>
            </div>
          </div>
        </>
      ) : showReply ? (
        // ----- The patient got a new time: tell them -----
        <>
          <p className="mb-3 text-sm font-medium text-slate-500">
            Patient {calledCount} of {appointments.length}
          </p>
          <div className="grid gap-6 md:grid-cols-[1fr_320px]">
            <PhoneCard
              appointment={justAnswered}
              label="On call"
              message={
                justAnswered.status === "Rescheduled – later today"
                  ? laterTodayReply(justAnswered.patient.preferredLanguage, justAnswered.startTime)
                  : justAnswered.status === "Rebooked – another doctor"
                    ? anotherDoctorReply(
                        justAnswered.patient.preferredLanguage,
                        justAnswered.startTime,
                        nameFor(justAnswered.doctorId, justAnswered.patient.preferredLanguage),
                      )
                    : anotherDayReply(
                      justAnswered.patient.preferredLanguage,
                      justAnswered.dayOffset,
                      justAnswered.startTime,
                    )
              }
            />
            <div>
              <h2 className="mb-3 text-sm font-medium text-slate-500">{justAnswered.status}</h2>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-emerald-800">
                {describeTimeChange(justAnswered, doctors)}
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
              label={current.offers ? "On call" : "Calling…"}
              message={buttonsOpening}
            />
            {/* Right: you play the patient */}
            {current.offers ? (
              <div>
                <h2 className="mb-3 text-sm font-medium text-slate-500">
                  {current.offersBecause === "no room today"
                    ? "Pressed “1 – Later today”, but there’s no room today"
                    : current.offersBecause === "another doctor"
                      ? "Pressed “5 – Another doctor today”"
                      : "Pressed “2 – Another day”"}{" "}
                  — the patient chooses…
                </h2>
                {/* Why there was no room (e.g. the 45-minute fairness rule) */}
                {current.offersBecause === "no room today" && (
                  <p className="mb-3 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-800">
                    {current.callLog?.at(-1)?.detail}
                  </p>
                )}
                <OfferButtons
                  key={current.id}
                  appointmentId={current.id}
                  offers={current.offers}
                  doctorNames={current.offers.map((o) => nameFor(o.doctorId, "English"))}
                />
              </div>
            ) : (
              <div>
                <h2 className="mb-3 text-sm font-medium text-slate-500">The patient answers…</h2>
                {/* key = new buttons for each patient */}
                <AnswerButtons
                  key={current.id}
                  appointmentId={current.id}
                  anotherDoctorToday={anotherDoctorToday}
                />
              </div>
            )}
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
            className={`inline-block rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 ${TAP}`}
          >
            Back to dashboard
          </Link>
        </div>
      )}
    </div>
  );
}

const languageCodes: Record<Language, string> = { English: "en", Tamil: "ta", Hindi: "hi" };

// The phone-style card: who's on the line, and what DocDelay says to them
// (one message, or — in Chat mode — the whole conversation as `children`).
function PhoneCard({
  appointment,
  label,
  message,
  children,
}: {
  appointment: AppointmentWithPatient;
  label: string;
  message?: string;
  children?: ReactNode;
}) {
  const { patient } = appointment;
  // The time they were first booked for (before any changes).
  const originalTime = appointment.timeHistory?.[0]?.oldStartTime ?? appointment.startTime;

  return (
    <div className="rounded-[2rem] bg-slate-900 p-3 shadow-xl">
      <div className="rounded-[1.5rem] bg-slate-800 p-6 text-white">
        <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">● {label}</p>
        <p className="mt-2 text-2xl font-semibold wrap-break-word">{patient.name}</p>
        <p className="tabular-nums text-slate-300">{patient.phone}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white/10 px-2 py-1">
            Language: {patient.preferredLanguage}
          </span>
          <span className="rounded-full bg-white/10 px-2 py-1">
            Appointment: {formatTime(originalTime)}
          </span>
        </div>

        {children ? (
          <div className="mt-6">{children}</div>
        ) : (
          <>
            <p className="mb-2 mt-6 text-xs font-medium uppercase tracking-wider text-slate-400">
              DocDelay says
            </p>
            <p
              lang={languageCodes[patient.preferredLanguage]}
              className="rounded-2xl rounded-tl-sm bg-white/10 p-4 leading-relaxed wrap-break-word"
            >
              {message}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
