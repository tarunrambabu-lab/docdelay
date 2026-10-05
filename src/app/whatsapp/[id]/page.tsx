// The WhatsApp screen (simulated): one phone-style chat per appointment.
// Address: /whatsapp/<appointment id>
//
// Nothing is really sent or received. You play the patient: tap an option,
// type, or send a voice note / photo (demo). Every message goes to the hms
// module (sendWhatsAppMessage), which runs the health check first and then
// the WhatsApp rules. This screen only SHOWS what the hms module decided.
//
// Who has a WhatsApp screen: only patients marked "WhatsApp OK", and only for
// an appointment DocDelay has contacted (affected, or pushed to a later time).
//
// Like the rest of the demo, the chat lives in the visitor's own private demo
// (their cookie), and "Reset demo" clears it.

import type { ReactNode } from "react";
import Link from "next/link";
import {
  getAnotherDoctorOptions,
  getAppointment,
  getDoctors,
  getHospital,
  getTimeNow,
  getUnavailability,
} from "@/hms/mockHms";
import type { ChatTurn, Language } from "@/hms/types";
import { anotherDoctorOffersScript, otherDayOffersScript, whatsappScript } from "@/lib/callScript";
import { doctorNameFor } from "@/lib/names";
import { ANSWERED_STATUSES, describeTimeChange, statusColors } from "@/lib/status";
import { formatWhen } from "@/lib/time";
import { TAP } from "@/app/tapTarget";
import { doctorBackAt } from "@/lib/returnCheck";
import { CLOCK_MODE, demoMoment } from "@/lib/clock";
import WhatsAppBox from "./WhatsAppBox";
import WhatsAppTranscript from "./WhatsAppTranscript";
import { tapListFor } from "./whatsappMenu";

export default async function WhatsAppScreen({ params }: PageProps<"/whatsapp/[id]">) {
  const { id } = await params;
  const appt = await getAppointment(id);
  const contacted = appt && (appt.unavailabilityId || appt.timeHistory?.length);

  // E.g. after "Reset demo", or a patient who isn't on WhatsApp.
  if (!appt || !contacted || !appt.patient.whatsappOptIn) {
    return (
      <Shell backHref="/">
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          {appt && !appt.patient.whatsappOptIn
            ? `${appt.patient.name} is not marked “WhatsApp OK”, so there is no WhatsApp chat. DocDelay reaches this patient by call and text message.`
            : "There is no WhatsApp chat for this appointment (DocDelay hasn’t contacted this patient)."}
        </p>
      </Shell>
    );
  }

  const { patient } = appt;
  const language = patient.preferredLanguage;
  const doctors = await getDoctors();
  const nameFor = (doctorId: string | undefined, lang: Language) => {
    const d = doctors.find((x) => x.id === doctorId);
    return d ? doctorNameFor(d, lang) : "";
  };
  const urgent = appt.status === "URGENT – staff call now";
  const answered = ANSWERED_STATUSES.includes(appt.status);
  const waiting = appt.status === "Affected – needs contact" || appt.status === "No answer";
  // "5 – Another doctor" — the same check as the call.
  const anotherDoctorFree = (await getAnotherDoctorOptions(appt.id)).length > 0;

  // The conversation so far. Before the patient's first message, an affected
  // patient who hasn't answered sees DocDelay's first message (the same
  // opening the hms module puts at the start of the chat). It names only the
  // hospital, the doctor and the time (see whatsappScript).
  let turns: ChatTurn[] = appt.whatsapp ?? [];
  const unavailability = appt.unavailabilityId
    ? await getUnavailability(appt.unavailabilityId)
    : undefined;
  if (turns.length === 0 && waiting && unavailability) {
    const opening = appt.offers
      ? appt.offersBecause === "another doctor"
        ? anotherDoctorOffersScript(
            language,
            appt.offers.map((o) => ({
              startTime: o.startTime,
              doctorName: nameFor(o.doctorId, language),
            })),
          )
        : otherDayOffersScript(language, appt.offers, appt.offersBecause === "no room today")
      : whatsappScript({
          language,
          hospitalName: (await getHospital()).name,
          doctorName: nameFor(appt.doctorId, language),
          appointmentTime: appt.startTime,
          untilTime: doctorBackAt(unavailability),
          anotherDoctorToday: anotherDoctorFree,
        });
    // (No saved time yet: the transcript shows the clock's time for it.)
    // (Not saved yet: in the demo it shows the demo time now.)
    const at = CLOCK_MODE === "demo" ? demoMoment(await getTimeNow()) : "";
    turns = [{ at, from: "docdelay", text: opening }];
  }

  // The offers on screen (A / B / C), to name the doctor on each button.
  const offers = waiting ? appt.offers : appt.change?.offers;
  const tapList = tapListFor(
    appt,
    language,
    anotherDoctorFree,
    (offers ?? []).map((o) => nameFor(o.doctorId, "English")),
  );

  return (
    <Shell backHref={`/?doctor=${appt.doctorId}&day=${appt.dayOffset}&appt=${appt.id}`}>
      {/* Status — stays at the top of the screen while you scroll */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 space-y-2 bg-slate-50/95 px-4 py-2 sm:-mx-6 sm:px-6">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span
            data-status={appt.status}
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[appt.status]}`}
          >
            {appt.status}
          </span>
          {appt.note && <span className="wrap-break-word text-orange-800">{appt.note}</span>}
          <span className="text-slate-600">
            {appt.status === "Cancelled" ? "" : formatWhen(appt.dayOffset, appt.startTime)}
          </span>
          {/* For the guided tour: the patient's answer is saved */}
          {answered && <span data-tour="whatsapp-answered" className="sr-only">Answer saved</span>}
        </p>
        {urgent && (
          <p
            role="alert"
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white"
          >
            URGENT – a staff member must call this patient now. Nothing was booked.
          </p>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        {/* The phone */}
        <div className="min-w-0 rounded-[2rem] bg-slate-900 p-2 shadow-xl sm:p-3">
          <div className="overflow-hidden rounded-[1.5rem] bg-[#ece5dd]">
            <div className="bg-teal-800 px-4 py-3 text-white">
              <p className="text-xs font-medium uppercase tracking-wider text-emerald-200">
                WhatsApp (simulated)
              </p>
              <p className="text-lg font-semibold wrap-break-word">{patient.name}</p>
              <p className="text-xs text-teal-100">
                <span className="whitespace-nowrap tabular-nums">{patient.phone}</span> · {language}
              </p>
            </div>
            <div className="p-3">
              {turns.length > 0 ? (
                <WhatsAppTranscript turns={turns} language={language} />
              ) : (
                <Note>
                  {appt.unavailabilityId
                    ? "No WhatsApp messages yet. This patient answered on a call; their update arrives here when staff press “Send updates”."
                    : "No WhatsApp messages yet. This patient’s time was moved; the heads-up arrives here when staff press “Send updates”."}
                </Note>
              )}
              {appt.whatsappStopped && (
                <Note>
                  The patient typed STOP. WhatsApp is closed for this appointment — DocDelay sends
                  nothing more here. Calls continue, and their update goes by text message (SMS).
                </Note>
              )}
            </div>
          </div>
        </div>

        {/* Right: you play the patient */}
        <div className="min-w-0">
          {appt.timeHistory && (
            <p className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-sm wrap-break-word text-emerald-800">
              {describeTimeChange(appt, doctors)}
            </p>
          )}
          {/* key = a fresh, empty box for each patient */}
          <WhatsAppBox key={appt.id} appointmentId={appt.id} tapList={tapList} />
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Any mention of a health concern hands the patient straight to staff. There is no STOP
            button: a patient ends WhatsApp by typing STOP.
          </p>
        </div>
      </div>
    </Shell>
  );
}

// The page frame: the "back" link and the heading.
function Shell({ backHref, children }: { backHref: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Link
        href={backHref}
        data-tour="back-to-dashboard"
        className={`text-sm font-medium text-teal-700 hover:underline ${TAP}`}
      >
        ← Back to dashboard
      </Link>
      <h1 className="mb-4 mt-3 text-2xl font-semibold text-slate-900">WhatsApp chat</h1>
      {children}
    </div>
  );
}

// A small grey note inside the chat (not a message).
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mt-3 max-w-[90%] rounded-lg bg-white/70 px-3 py-2 text-center text-xs leading-relaxed text-slate-600">
      {children}
    </p>
  );
}
