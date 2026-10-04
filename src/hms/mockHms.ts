// The FAKE hospital system (HMS).
//
// This is the ONLY file that reads or changes hospital data. The rest of the
// app calls the functions below and never touches the data files directly.
// To connect a real HMS later, write a new file with the same functions
// (same names, same return types) and switch the imports over to it.
//
// Where the data lives:
//   - mockData.json = the untouched starting data (never changed by the app).
//     It holds today and the next 7 days; each appointment has a "dayOffset"
//     (0 = today, 1 = tomorrow, …), so the demo always starts "today".
//   - Each visitor's CURRENT state (statuses, times, unavailabilities, pending
//     updates, simulated text messages) is rebuilt on every request from the
//     list of steps they took, kept in a cookie in their own browser
//     (see visitorState.ts). So every visitor gets their own demo, and
//     "Reset demo" just forgets their steps.
//
// The functions are "async" even though the fake data is instant,
// because a real HMS will be reached over the network.

import startingData from "./mockData.json";
import type {
  Appointment,
  AppointmentStatus,
  Channel,
  Language,
  AppointmentWithPatient,
  CallLogEntry,
  CallResult,
  Doctor,
  Hospital,
  InsideAbsenceGroup,
  InsideAbsenceRow,
  Patient,
  PendingUpdate,
  PendingUpdateWithDetails,
  SlotOffer,
  SmsMessage,
  Unavailability,
  UnavailabilityReason,
  WhatsAppMedia,
} from "./types";
import {
  clearSteps,
  isNearlyFull,
  MAX_CHAT_TEXT,
  readSteps,
  writeSteps,
  type AiAction,
  type DemoStep,
  type StaffReason,
} from "./visitorState";
import {
  anchorTime,
  DAY_START,
  DAYS_TO_SEARCH,
  findAnotherDoctorSlots,
  findOtherDaySlots,
  emptySlotsToday,
  isOutsideClinicHours,
  wishEndsAt,
  wishStartsAt,
  pickOnDay,
  isClosedDay,
  listFreeSlots,
  originalTimeOf,
  pickClosestPerDay,
  pickOffers,
  NORMAL_DAY_END,
  OFFERS_TO_MAKE,
  planLaterToday,
  SLOT_MINUTES,
  type SlotQuery,
  type TimeOfDay,
  type TimeWish,
} from "@/lib/reschedulingRules";
import {
  anotherDayReply,
  anotherDoctorOffersScript,
  anotherDoctorReply,
  callScript,
  dayLabelFor,
  laterTodayReply,
  OFFER_LETTERS,
  otherDayOffersScript,
  whatsappScript,
} from "@/lib/callScript";
import {
  askTodayOrAnotherDay,
  cancelledReply,
  changeMenuReply,
  clinicHoursIntro,
  dayClosedPrefix,
  dayFullPrefix,
  doctorBackNothingBeforePrefix,
  doctorBackIntro,
  doctorBackLaterPrefix,
  doctorBackNoneTodayPrefix,
  emergencyOnlyReply,
  headsUpCancelQuestion,
  headsUpFineReply,
  headsUpStaffReply,
  noFreeTodayPrefix,
  noMatchPrefix,
  noOtherDoctorFreeReply,
  slotTakenPrefix,
  staffWillCallReply,
  couldntUnderstandReply,
  unclearReply,
  urgentReply,
} from "@/lib/chatReplies";
import { realTimestamp } from "@/lib/clock";
import { bookingsStartAt } from "@/lib/returnCheck";
import { describeUnderstanding } from "@/lib/understanding/describe";
import { doctorNameFor } from "@/lib/names";
import { interpretWithRules, mentionsHealth } from "@/lib/understanding";
import { readHeadsUpReply } from "@/lib/understanding/headsUpReply";
import type { Preferences, Understanding } from "@/lib/understanding/types";
import { headsUpSms, timeChangedSms } from "@/lib/smsText";
import {
  formatDate,
  formatTime,
  formatTimeFor,
  formatWhen,
  fromMinutes,
  isValidTime,
  toMinutes,
} from "@/lib/time";

// Hospital, doctors and patients never change, so we read them straight
// from the starting data. (Tell TypeScript the JSON matches our types.)
const hospital = startingData.hospital as Hospital;
const doctors = startingData.doctors as Doctor[];
const patients = startingData.patients as Patient[];

// ---------- Each visitor's current state ----------

// Everything that CAN change.
interface HmsState {
  appointments: Appointment[];
  unavailabilities: Unavailability[];
  pendingUpdates: PendingUpdate[]; // texts waiting to be sent (one per appointment)
  messages: SmsMessage[]; // simulated update messages that were "sent" (SMS or WhatsApp)
}

function startingState(): HmsState {
  return {
    // structuredClone makes a full copy, so the starting data stays untouched.
    appointments: structuredClone(startingData.appointments) as Appointment[],
    unavailabilities: [],
    pendingUpdates: [],
    messages: [],
  };
}

// Rebuild a demo: start from the starting data and redo every step in order.
function replay(steps: DemoStep[]): HmsState {
  const state = startingState();
  for (const step of steps) {
    switch (step.kind) {
      case "unavailable":
        applyUnavailable(state, step);
        break;
      case "call":
        applyCall(state, step);
        break;
      case "offer":
        applyOffer(state, step);
        break;
      case "send":
        applySend(state, step);
        break;
      case "chat":
        applyChat(state, step);
        break;
      case "whatsapp":
        applyWhatsApp(state, step);
        break;
      case "falseAlarm":
        applyFalseAlarm(state, step);
        break;
      case "book":
        applyBook(state, step);
        break;
      case "returnTime":
        applyReturnTime(state, step);
        break;
      case "available":
        applyAvailable(state, step);
        break;
      case "ai":
        applyAi(state, step);
        break;
    }
  }
  return state;
}

// This visitor's current state.
async function loadState(): Promise<HmsState> {
  return replay(await readSteps());
}

// Does this appointment START inside the doctor's unavailable window?
// Unavailability is always about today (dayOffset 0).
// (from ≤ start < until — someone booked exactly at "until" is fine.)
function isInWindow(
  appt: Appointment,
  window: Pick<Unavailability, "doctorId" | "fromTime" | "untilTime">,
): boolean {
  return (
    appt.dayOffset === 0 &&
    appt.doctorId === window.doctorId &&
    appt.startTime >= window.fromTime &&
    appt.startTime < window.untilTime
  );
}

function withPatient(appt: Appointment): AppointmentWithPatient {
  return { ...appt, patient: patients.find((p) => p.id === appt.patientId)! };
}

// Earliest day first, then earliest time ("09:15" < "10:00" works as text).
function byDayAndTime(a: Appointment, b: Appointment): number {
  return a.dayOffset - b.dayOffset || a.startTime.localeCompare(b.startTime);
}

// ---------- Reading ----------

export async function getHospital(): Promise<Hospital> {
  return hospital;
}

export async function getDoctors(): Promise<Doctor[]> {
  return doctors;
}

export async function getDoctor(doctorId: string): Promise<Doctor | undefined> {
  return doctors.find((d) => d.id === doctorId);
}

// Is the hospital closed on this day? (0 = today, which is always open.)
export async function isClosed(dayOffset: number): Promise<boolean> {
  return isClosedDay(dayOffset);
}

// One doctor's appointments on one day, earliest first, with patient details.
// Empty on days the hospital is closed.
export async function getAppointmentsForDay(
  doctorId: string,
  dayOffset: number,
): Promise<AppointmentWithPatient[]> {
  if (isClosedDay(dayOffset)) return [];
  return (await loadState()).appointments
    .filter((a) => a.doctorId === doctorId && a.dayOffset === dayOffset)
    .sort(byDayAndTime)
    .map(withPatient);
}

// Appointments that were first booked with this doctor on this day but have
// since moved to another day or another doctor (so the front desk can still
// see where they went).
export async function getAppointmentsMovedAwayFrom(
  doctorId: string,
  dayOffset: number,
): Promise<AppointmentWithPatient[]> {
  return (await loadState()).appointments
    .filter((a) => {
      const first = a.timeHistory?.[0];
      if (!first || first.oldDayOffset !== dayOffset) return false;
      const firstDoctorId = first.oldDoctorId ?? a.doctorId;
      return firstDoctorId === doctorId && (a.dayOffset !== dayOffset || a.doctorId !== doctorId);
    })
    .map(withPatient);
}

// Every doctor unavailability recorded today, in the order they were added.
export async function getUnavailabilities(): Promise<Unavailability[]> {
  return (await loadState()).unavailabilities;
}

export async function getUnavailability(id: string): Promise<Unavailability | undefined> {
  return (await loadState()).unavailabilities.find((u) => u.id === id);
}

// All appointments affected by one "doctor unavailable" event (whatever
// their status, day or time is now), earliest first, with patient details.
export async function getAffectedAppointments(
  unavailabilityId: string,
): Promise<AppointmentWithPatient[]> {
  return (await loadState()).appointments
    .filter((a) => a.unavailabilityId === unavailabilityId)
    .sort(byDayAndTime)
    .map(withPatient);
}

// The CALL QUEUE for one "doctor unavailable" event: who still needs a call,
// in the order to call them.
//   - Anyone who has already answered (on a call or on WhatsApp) is skipped.
//   - A patient who started replying on WhatsApp but hasn't finished goes to
//     the END of the queue, to give them time to finish there.
export async function getCallQueue(unavailabilityId: string): Promise<AppointmentWithPatient[]> {
  const toCall = (await loadState()).appointments
    .filter(
      (a) => a.unavailabilityId === unavailabilityId && a.status === "Affected – needs contact",
    )
    .sort(byDayAndTime);
  return [
    ...toCall.filter((a) => !a.whatsappStarted),
    ...toCall.filter((a) => a.whatsappStarted),
  ].map(withPatient);
}

export async function getAppointment(id: string): Promise<AppointmentWithPatient | undefined> {
  const appt = (await loadState()).appointments.find((a) => a.id === id);
  return appt && withPatient(appt);
}

// "5 – Another doctor today" (Buttons only): the slots this patient would be
// offered right now. Empty = don't show the option at all.
export async function getAnotherDoctorOptions(appointmentId: string): Promise<SlotOffer[]> {
  const state = await loadState();
  const appt = state.appointments.find((a) => a.id === appointmentId);
  if (!appt || appt.status !== "Affected – needs contact" || appt.offers) return [];
  return anotherDoctorSlotsIn(state, appt);
}

// Texts waiting to be sent, oldest change first, with appointment details.
export async function getPendingUpdates(): Promise<PendingUpdateWithDetails[]> {
  const state = await loadState();
  return state.pendingUpdates.map((u) => ({
    ...u,
    appointment: withPatient(state.appointments.find((a) => a.id === u.appointmentId)!),
  }));
}

// All simulated text messages that were "sent", newest first.
export async function getMessages(): Promise<SmsMessage[]> {
  return [...(await loadState()).messages].reverse();
}

// ---------- Changing ----------

// Is this visitor's demo history nearly too big for its cookie?
// (Then they should press "Reset demo".)
export async function isDemoNearlyFull(): Promise<boolean> {
  return isNearlyFull();
}

// Each change below has two parts:
//   - an exported function the app calls: it rebuilds the visitor's demo,
//     makes the change, and saves the new step in the visitor's cookie;
//   - an "apply…" function that makes the change to a state. The same apply
//     function is used again every time the demo is rebuilt from the steps,
//     so it must only use the step's own time (step.at), never "now".

// Record that a doctor is unavailable between two times today.
// Returns null if it couldn't be saved (the visitor's demo is full).
export async function markDoctorUnavailable(input: {
  doctorId: string;
  reason: UnavailabilityReason;
  fromTime: string;
  untilTime: string;
}): Promise<Unavailability | null> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "unavailable", at: realTimestamp(), ...input };
  const unavailability = applyUnavailable(replay(steps), step);
  return (await writeSteps([...steps, step])) ? unavailability : null;
}

// Every appointment that starts inside the window becomes
// "Affected – needs contact" and remembers which event affected it.
function applyUnavailable(
  state: HmsState,
  step: Extract<DemoStep, { kind: "unavailable" }>,
): Unavailability {
  const { doctorId, reason, fromTime, untilTime, at } = step;
  const input = { doctorId, reason, fromTime, untilTime };
  const id = `unavail-${at}`;

  let affectedCount = 0;
  for (const appt of state.appointments) {
    if (isInWindow(appt, input)) {
      appt.status = "Affected – needs contact";
      appt.unavailabilityId = id;
      affectedCount++;
    }
  }

  const unavailability: Unavailability = { id, ...input, affectedCount };
  state.unavailabilities.push(unavailability);
  return unavailability;
}

// ---------- Knowing when the doctor is back (waiting check, step 1) ----------

// Staff change a doctor's expected return time — earlier or later, at any
// time until the doctor is marked available. It is recorded and shown, and
// NOTHING else happens: no patient is moved and no message is sent.
//   - LATER: new bookings start at the new time (see bookingsStartAt).
//   - EARLIER: shown and logged only; bookings never start before the FIRST
//     expected time.
// Returns false if nothing was saved: unknown absence, doctor already marked
// available, a time that isn't after the absence's start, the same time as
// now, or the visitor's demo is full.
export async function changeExpectedReturn(
  unavailabilityId: string,
  untilTime: string,
): Promise<boolean> {
  const steps = await readSteps();
  const state = replay(steps);
  const absence = state.unavailabilities.findIndex((u) => u.id === unavailabilityId);
  const step: DemoStep = { kind: "returnTime", at: realTimestamp(), absence, untilTime };
  if (!applyReturnTime(state, step)) return false;
  return writeSteps([...steps, step]);
}

function applyReturnTime(state: HmsState, step: Extract<DemoStep, { kind: "returnTime" }>): boolean {
  const unavailability = state.unavailabilities[step.absence];
  if (!unavailability || unavailability.markedAvailableAt) return false;
  if (!isValidTime(step.untilTime) || step.untilTime <= unavailability.fromTime) return false;
  if (step.untilTime === unavailability.untilTime) return false; // nothing to change
  unavailability.returnTimeChanges = [
    ...(unavailability.returnTimeChanges ?? []),
    {
      changedAt: new Date(step.at).toISOString(),
      oldTime: unavailability.untilTime,
      newTime: step.untilTime,
    },
  ];
  unavailability.untilTime = step.untilTime;
  return true;
}

// Staff press "Mark doctor available" when the doctor is physically back.
// It ends the absence: the "is the doctor back?" check stops and the expected
// time can't be changed any more. No patient is moved, no message is sent,
// and the booking rules don't change (even if it's pressed early).
// Returns false if nothing was saved (unknown absence, or already marked).
export async function markDoctorAvailable(unavailabilityId: string): Promise<boolean> {
  const steps = await readSteps();
  const state = replay(steps);
  const absence = state.unavailabilities.findIndex((u) => u.id === unavailabilityId);
  const step: DemoStep = { kind: "available", at: realTimestamp(), absence };
  if (!applyAvailable(state, step)) return false;
  return writeSteps([...steps, step]);
}

function applyAvailable(state: HmsState, step: Extract<DemoStep, { kind: "available" }>): boolean {
  const unavailability = state.unavailabilities[step.absence];
  if (!unavailability || unavailability.markedAvailableAt) return false;
  unavailability.markedAvailableAt = new Date(step.at).toISOString();
  return true;
}

// Patients whose time today is INSIDE this absence although DocDelay hasn't
// contacted them about it — it happens when staff enter a LATER return time.
// Read-only: a list for staff, earliest time first. Empty once the doctor is
// marked available. (Patients still waiting to be contacted aren't listed:
// they are simply offered times from the new return time.)
export async function getInsideAbsence(unavailabilityId: string): Promise<InsideAbsenceRow[]> {
  const state = await loadState();
  const unavailability = state.unavailabilities.find((u) => u.id === unavailabilityId);
  return unavailability ? insideAbsenceIn(state, unavailability) : [];
}

// The appointments with an update that is waiting to be sent and names a time
// inside a doctor's current absence (for the warning next to "Send updates").
export async function getUpdatesInsideAbsence(): Promise<string[]> {
  const state = await loadState();
  return state.unavailabilities
    .flatMap((u) => insideAbsenceIn(state, u))
    .filter((row) => row.unsentUpdate)
    .map((row) => row.appointment.id);
}

function insideAbsenceIn(state: HmsState, unavailability: Unavailability): InsideAbsenceRow[] {
  if (unavailability.markedAvailableAt) return [];
  const inside = (doctorId: string, dayOffset: number, time: string) =>
    dayOffset === 0 &&
    doctorId === unavailability.doctorId &&
    time >= unavailability.fromTime &&
    time < unavailability.untilTime;
  const groups: Partial<Record<AppointmentStatus, InsideAbsenceGroup>> = {
    Scheduled: "Never contacted",
    "Rescheduled – later today": "Rebooked by DocDelay",
    "Rebooked – another doctor": "Rebooked by DocDelay",
    "Time moved": "Pushed by DocDelay",
  };

  const rows: InsideAbsenceRow[] = [];
  for (const appt of state.appointments) {
    // Their time itself is inside the absence.
    const group = groups[appt.status];
    if (group && inside(appt.doctorId, appt.dayOffset, appt.startTime)) {
      rows.push({
        appointment: withPatient(appt),
        group,
        time: appt.startTime,
        unsentUpdate: state.pendingUpdates.some((u) => u.appointmentId === appt.id),
      });
    }
    // They are looking at an offer today (with this doctor) that is inside it.
    // Picking it is refused by the booking check; staff should know anyway.
    if (appt.unavailabilityId === unavailability.id && appt.status !== "Cancelled") {
      const offer = [...(appt.offers ?? []), ...(appt.change?.offers ?? [])].find(
        (o) => !o.doctorId && inside(unavailability.doctorId, o.dayOffset, o.startTime),
      );
      if (offer) {
        rows.push({
          appointment: withPatient(appt),
          group: "Choosing a time",
          time: offer.startTime,
          unsentUpdate: false,
        });
      }
    }
  }
  return rows.sort((a, b) => a.time.localeCompare(b.time));
}

// Save what a patient answered on a call: add a line to the appointment's
// call log and change its status.
//   - "Later today" finds a new time today straight away; if there's no room,
//     the patient is offered other days instead.
//   - "Another day" offers other days.
// Only patients still waiting for a call (and not already looking at offers)
// can be recorded — this stops a double-click from logging the same call twice.
// Returns false if skipped (or the visitor's demo is full).
export async function recordCallResult(
  appointmentId: string,
  result: CallResult,
): Promise<boolean> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "call", at: realTimestamp(), appointmentId, result };
  if (!applyCall(replay(steps), step)) return false;
  return writeSteps([...steps, step]);
}

function applyCall(state: HmsState, step: Extract<DemoStep, { kind: "call" }>): boolean {
  const { appointmentId, result, at } = step;
  const appt = state.appointments.find((a) => a.id === appointmentId);
  if (!appt || appt.status !== "Affected – needs contact" || appt.offers) return false;

  // "5 – Another doctor today" only counts if there's a slot right now
  // (the button is hidden otherwise; this also catches an out-of-date page).
  const anotherDoctorOffers =
    result === "Wants another doctor today" ? anotherDoctorSlotsIn(state, appt) : [];
  if (result === "Wants another doctor today" && anotherDoctorOffers.length === 0) return false;

  const logEntry: CallLogEntry = { calledAt: new Date(at).toISOString(), result };
  appt.callLog = [...(appt.callLog ?? []), logEntry];
  delete appt.slotJustTaken;
  delete appt.doctorBackLater; // the "Sorry, that time was just taken" line has been heard

  if (result === "Wants another doctor today") {
    appt.offers = anotherDoctorOffers;
    appt.offersBecause = "another doctor";
  } else if (result === "Wants later today") {
    const noRoomBecause = rescheduleLaterToday(state, appt, at);
    if (noRoomBecause) {
      logEntry.detail = `No room today: ${noRoomBecause}`;
      offerOtherDays(state, appt, "no room today");
    }
  } else if (result === "Wants another day") {
    offerOtherDays(state, appt, "asked");
  } else {
    appt.status = result;
  }
  return true;
}

// The patient picked one of the other-day offers (0 = A, 1 = B, …),
// or null for "None of these – call me".
// Returns "booked", "none", "taken" (that slot got booked meanwhile — fresh
// offers are made), or "skipped" (nothing to choose, e.g. a double-click).
export async function chooseOffer(
  appointmentId: string,
  choice: number | null,
): Promise<"booked" | "none" | "taken" | "skipped"> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "offer", at: realTimestamp(), appointmentId, choice };
  const outcome = applyOffer(replay(steps), step);
  if (outcome === "skipped") return outcome;
  return (await writeSteps([...steps, step])) ? outcome : "skipped";
}

function applyOffer(
  state: HmsState,
  step: Extract<DemoStep, { kind: "offer" }>,
): "booked" | "none" | "taken" | "skipped" {
  const { appointmentId, choice, at } = step;
  const appt = state.appointments.find((a) => a.id === appointmentId);
  if (!appt?.offers || appt.status !== "Affected – needs contact") return "skipped";
  const anotherDoctor = appt.offersBecause === "another doctor";

  const log = (detail: string) =>
    (appt.callLog = [
      ...(appt.callLog ?? []),
      {
        calledAt: new Date(at).toISOString(),
        result: anotherDoctor ? "Wants another doctor today" : "Wants another day",
        detail,
      },
    ]);

  if (choice === null) {
    appt.status = "Needs staff call";
    appt.note = anotherDoctor ? "Wanted another doctor today" : "Wants a different day";
    delete appt.offers;
    delete appt.offersBecause;
    delete appt.slotJustTaken;
    delete appt.doctorBackLater;
    log("None of these – call me");
    return "none";
  }

  const offer = appt.offers[choice];
  if (!offer) return "skipped";

  if (anotherDoctor) {
    // Book it — bookWithAnotherDoctor re-checks the slot is still empty.
    if (!bookWithAnotherDoctor(state, appt, offer, at)) {
      // Taken meanwhile: fresh options if there are any, otherwise back to
      // the 1–4 menu. Either way the patient first hears "Sorry, that time
      // was just taken".
      // (If the real reason is that the other doctor is away at that time,
      // they hear "Sorry, Dr. … will now be back at …" instead.)
      const fresh = anotherDoctorSlotsIn(state, appt);
      const away = refusedBecauseAway(state, offer.doctorId!, offer);
      if (away) {
        const awayDoctor = doctors.find((d) => d.id === away.doctorId)!;
        log(
          `Picked ${OFFER_LETTERS[choice]}, but ${awayDoctor.name} is now back at ${formatTime(away.backAt)}`,
        );
        appt.doctorBackLater = away;
      } else {
        log(`Picked ${OFFER_LETTERS[choice]}, but it was just taken`);
        appt.slotJustTaken = true;
      }
      if (fresh.length > 0) {
        appt.offers = fresh;
      } else {
        delete appt.offers;
        delete appt.offersBecause;
      }
      return "taken";
    }
    const doctor = doctors.find((d) => d.id === offer.doctorId)!;
    log(`Picked ${OFFER_LETTERS[choice]}: ${formatWhen(0, offer.startTime)} with ${doctor.name}`);
    return "booked";
  }

  // Book it — bookSlotIn re-checks every rule (e.g. nobody took it meanwhile).
  if (!bookSlotIn(state, appt, offer, at).ok) {
    // Refused because the doctor's return time is now later than this slot:
    // the patient hears the real reason first. (The fresh options are the
    // same as before.)
    const away = refusedBecauseAway(state, appt.doctorId, offer);
    offerOtherDays(state, appt, appt.offersBecause === "no room today" ? "no room today" : "asked");
    if (away) {
      const awayDoctor = doctors.find((d) => d.id === away.doctorId)!;
      log(
        `Picked ${OFFER_LETTERS[choice]}, but ${awayDoctor.name} is now back at ${formatTime(away.backAt)}`,
      );
      appt.doctorBackLater = away;
    }
    return "taken";
  }
  log(`Picked ${OFFER_LETTERS[choice]}: ${formatWhen(offer.dayOffset, offer.startTime)}`);
  return "booked";
}

// Give a patient who pressed "1 – Later today" a new time today, following the
// rules in lib/reschedulingRules.ts. Changes `state`; the caller saves it.
// Returns null if it worked, or the reason there was no room today.
function rescheduleLaterToday(state: HmsState, appt: Appointment, at: number): string | null {
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return "unknown unavailability"; // shouldn't happen
  const todaysAppointments = state.appointments.filter(
    (a) => a.doctorId === appt.doctorId && a.dayOffset === 0,
  );
  const plan = planLaterToday(appt, todaysAppointments, bookingsStartAt(unavailability));

  if (plan.kind === "no room") return plan.why;

  // The patient first, then (if there was a push) everyone who moves back.
  moveAppointment(
    state,
    appt,
    0,
    plan.newStartTime,
    "Patient chose a later time today",
    unavailability,
    at,
  );
  appt.status = "Rescheduled – later today";

  if (plan.kind === "push") {
    for (const p of plan.pushed) {
      const other = state.appointments.find((a) => a.id === p.appointmentId)!;
      moveAppointment(
        state,
        other,
        0,
        p.newStartTime,
        "Pushed back 15 minutes to make room for a rescheduled patient",
        unavailability,
        at,
      );
      // Only plain bookings become "Time moved". Someone already
      // "Rescheduled – later today" keeps that status (their new time still shows).
      if (other.status === "Scheduled") other.status = "Time moved";
      // A patient who wasn't affected gets the short heads-up ("Reply 1 if
      // that's fine, 2 to cancel, 3 to talk to a person") instead of the "Reply 1 to confirm, 2 to change" update.
      if (!other.unavailabilityId) {
        state.pendingUpdates.find((u) => u.appointmentId === other.id)!.headsUp = true;
      }
    }
  }
  return null;
}

// Find other-day slots for the patient and keep them on the appointment
// until they pick one. If there are none at all in the coming days, the
// patient needs a staff call. Changes `state`; the caller saves it.
function offerOtherDays(
  state: HmsState,
  appt: Appointment,
  because: "asked" | "no room today",
): void {
  const doctorsAppointments = state.appointments.filter((a) => a.doctorId === appt.doctorId);
  const offers = findOtherDaySlots(appt, doctorsAppointments);

  if (offers.length === 0) {
    appt.status = "Needs staff call";
    appt.note =
      because === "no room today"
        ? "No room today or in the next days"
        : "No free slot in the next days";
    delete appt.offers;
    delete appt.offersBecause;
    return;
  }
  appt.offers = offers;
  appt.offersBecause = because;
}

// Change an appointment's day and time: note it in its history and keep ONE
// pending update for the patient with their latest time (nothing is sent yet —
// see sendPendingUpdates). Changes `state`; the caller saves it.
function moveAppointment(
  state: HmsState,
  appt: Appointment,
  newDayOffset: number,
  newStartTime: string,
  why: string,
  unavailability: Unavailability,
  at: number, // when it happened (the step's time)
  newDoctorId?: string, // only when the patient moves to a different doctor
): void {
  const now = new Date(at).toISOString();
  const doctorChange =
    newDoctorId && newDoctorId !== appt.doctorId
      ? { oldDoctorId: appt.doctorId, newDoctorId }
      : {};
  appt.timeHistory = [
    ...(appt.timeHistory ?? []),
    {
      changedAt: now,
      oldDayOffset: appt.dayOffset,
      oldStartTime: appt.startTime,
      newDayOffset,
      newStartTime,
      ...doctorChange,
      why,
    },
  ];
  if (newDoctorId) appt.doctorId = newDoctorId;
  appt.dayOffset = newDayOffset;
  appt.startTime = newStartTime;
  appt.endTime = fromMinutes(toMinutes(newStartTime) + SLOT_MINUTES);

  // Replace this patient's pending update (if any) with the latest day and time.
  state.pendingUpdates = state.pendingUpdates.filter((u) => u.appointmentId !== appt.id);
  state.pendingUpdates.push({
    appointmentId: appt.id,
    newDayOffset,
    newStartTime,
    reason: unavailability.reason,
    updatedAt: now,
  });
}

// ---------- "5 – Another doctor today" (Buttons only) ----------

// Doctors approved to cover for this doctor: on the hospital's "can cover
// for" list (mockData.json) AND the same specialty.
function coveringDoctorsFor(doctorId: string): Doctor[] {
  const doctor = doctors.find((d) => d.id === doctorId);
  if (!doctor) return [];
  return doctors.filter(
    (d) =>
      d.id !== doctorId &&
      d.canCoverFor?.includes(doctorId) === true &&
      d.specialty === doctor.specialty,
  );
}

// The slots to offer this patient with another doctor today (see
// findAnotherDoctorSlots in lib/reschedulingRules.ts for the rules).
// A covering doctor's slot is left out if it starts inside that doctor's OWN
// absence today (see isAwayAt) — so the list is filtered first, then cut to
// OFFERS_TO_MAKE.
function anotherDoctorSlotsIn(state: HmsState, appt: Appointment): SlotOffer[] {
  return findAnotherDoctorSlots(
    originalTimeOf(appt),
    coveringDoctorsFor(appt.doctorId).map((d) => ({
      doctorId: d.id,
      appointments: state.appointments.filter((a) => a.doctorId === d.id),
    })),
    Infinity, // every empty slot; cut down below
  )
    .filter((o) => !isAwayAt(state, o.doctorId!, o.startTime))
    .slice(0, OFFERS_TO_MAKE);
}

// Is this doctor away at this time today? True if the time is inside one of
// the doctor's own absences: from its start until the time bookings may start
// again (bookingsStartAt — the later of the first and the current expected
// return time). Nobody is booked with a covering doctor at such a time.
function isAwayAt(state: HmsState, doctorId: string, startTime: string): boolean {
  return state.unavailabilities.some(
    (u) => u.doctorId === doctorId && startTime >= u.fromTime && startTime < bookingsStartAt(u),
  );
}

// WHY a picked slot was refused, when the reason is the doctor's return time:
// the slot is today and starts while that doctor is away (usually because the
// expected return time was made LATER after the slot was offered). Returns
// which doctor and when bookings with them start again — or undefined if
// that isn't the reason (then someone else took the slot).
function refusedBecauseAway(
  state: HmsState,
  doctorId: string,
  slot: SlotOffer,
): { doctorId: string; backAt: string } | undefined {
  if (slot.dayOffset !== 0) return undefined;
  const absence = state.unavailabilities.find(
    (u) =>
      u.doctorId === doctorId &&
      slot.startTime >= u.fromTime &&
      slot.startTime < bookingsStartAt(u),
  );
  return absence && { doctorId, backAt: bookingsStartAt(absence) };
}

// The "Sorry, …" line a patient gets when the slot they picked was refused:
// the real reason — "Dr. … will now be back at …" if the doctor is away at
// that time, otherwise "that time was just taken". Wording only: which fresh
// options follow is decided elsewhere and doesn't change.
function refusedPrefix(
  state: HmsState,
  language: Language,
  doctorId: string,
  slot: SlotOffer,
): string {
  const away = refusedBecauseAway(state, doctorId, slot);
  if (!away) return slotTakenPrefix(language);
  const doctor = doctors.find((d) => d.id === away.doctorId)!;
  return doctorBackLaterPrefix(language, doctorNameFor(doctor, language), away.backAt);
}

// "Another doctor from the same department can see you today: A) Dr. …, 9:30 AM, …"
// in the patient's language, for offers with another doctor.
function anotherDoctorOffersText(language: Language, offers: SlotOffer[]): string {
  return anotherDoctorOffersScript(
    language,
    offers.map((o) => ({
      startTime: o.startTime,
      doctorName: doctorNameFor(doctors.find((d) => d.id === o.doctorId)!, language),
    })),
  );
}

// Book a slot with another doctor: re-check it's STILL one of the allowed
// empty slots (approved doctor, today, at or after the original time, ending
// by 5 PM), then move the appointment there. Moving it frees the patient's
// original slot. Nobody else moves. Returns false if the slot isn't allowed
// any more. Changes `state`; the caller saves it.
function bookWithAnotherDoctor(
  state: HmsState,
  appt: Appointment,
  offer: SlotOffer,
  at: number,
): boolean {
  if (appt.status !== "Affected – needs contact") return false;
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability || !offer.doctorId || offer.dayOffset !== 0) return false;

  const stillFree = listFreeSlots(
    state.appointments.filter((a) => a.doctorId === offer.doctorId),
    { days: [0] },
    { todayFrom: originalTimeOf(appt) },
  ).some((f) => f.startTime === offer.startTime);
  const approved = coveringDoctorsFor(appt.doctorId).some((d) => d.id === offer.doctorId);
  if (!stillFree || !approved) return false;
  // Never during the covering doctor's own absence.
  if (isAwayAt(state, offer.doctorId, offer.startTime)) return false;

  moveAppointment(
    state,
    appt,
    0,
    offer.startTime,
    "Patient chose another doctor today",
    unavailability,
    at,
    offer.doctorId,
  );
  appt.status = "Rebooked – another doctor";
  delete appt.offers;
  delete appt.offersBecause;
  delete appt.slotJustTaken;
  delete appt.doctorBackLater;
  return true;
}

// "Send" every pending update: turn each into ONE message in the outbox (in
// the patient's language) and clear the pending list. Nothing is really sent.
// If a patient is moved again later, they get a new pending update.
// Which channel — never both:
//   - "WhatsApp OK" patients (who haven't sent STOP) get it on WhatsApp;
//   - if their WhatsApp fails, it falls back to a text message (SMS). A real
//     system would wait 15 minutes first; the demo falls back straight away;
//   - everyone else gets a text message (SMS).
// Returns how many messages were "sent".
export async function sendPendingUpdates(): Promise<number> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "send", at: realTimestamp() };
  const sent = applySend(replay(steps), step);
  if (sent === 0) return 0;
  return (await writeSteps([...steps, step])) ? sent : 0;
}

function applySend(state: HmsState, step: Extract<DemoStep, { kind: "send" }>): number {
  const now = new Date(step.at).toISOString();

  for (const update of state.pendingUpdates) {
    const appt = state.appointments.find((a) => a.id === update.appointmentId)!;
    const patient = patients.find((p) => p.id === appt.patientId)!;
    const doctor = doctors.find((d) => d.id === appt.doctorId)!;
    // Moved to another doctor? Then the text also says "instead of Dr. …".
    const firstDoctorId = appt.timeHistory?.[0]?.oldDoctorId;
    const previousDoctor =
      firstDoctorId && firstDoctorId !== appt.doctorId
        ? doctors.find((d) => d.id === firstDoctorId)
        : undefined;
    const language = patient.preferredLanguage;
    const wantsWhatsApp = patient.whatsappOptIn === true && !appt.whatsappStopped;
    const onWhatsApp = wantsWhatsApp && !patient.whatsappFails;
    // A pushed (not affected) patient gets the short heads-up; everyone else
    // gets the update they can answer with 1 or 2.
    const text = update.headsUp
      ? headsUpSms({
          language,
          hospitalName: hospital.name,
          doctorName: doctorNameFor(doctor, language),
          minutesLater: toMinutes(update.newStartTime) - toMinutes(originalTimeOf(appt)),
          newStartTime: update.newStartTime,
        })
      : timeChangedSms({
          language,
          hospitalName: hospital.name,
          doctorName: doctorNameFor(doctor, language),
          previousDoctorName: previousDoctor && doctorNameFor(previousDoctor, language),
          // PRIVACY (FRD 6.1): on WhatsApp the update always says "due to a
          // schedule change", whatever the reason — previews show on locked
          // phones. Wording only. (The SMS wording is unchanged: REVIEW.md.)
          reason: onWhatsApp ? "Other" : update.reason,
          newDayOffset: update.newDayOffset,
          newStartTime: update.newStartTime,
        });
    state.messages.push({
      id: `sms-${state.messages.length + 1}`,
      channel: onWhatsApp ? "WhatsApp" : "SMS",
      ...(wantsWhatsApp && !onWhatsApp ? { whatsappFailed: true } : {}),
      ...(update.headsUp ? { headsUp: true } : {}),
      sentAt: now,
      appointmentId: appt.id,
      toName: patient.name,
      toPhone: patient.phone,
      language,
      text,
    });
    if (onWhatsApp) appt.whatsapp = [...(appt.whatsapp ?? []), { at: now, from: "docdelay", text }];
    // From now on a bare "1" on WhatsApp means "confirmed" (see applyWhatsApp).
    if (update.headsUp) appt.headsUpSent = true;
    else appt.awaitingUpdateReply = true;
  }

  const sent = state.pendingUpdates.length;
  state.pendingUpdates = [];
  return sent;
}

// ---------- Tools: check_free_slots and book_slot ----------
// Used by the chat (rule-based today, AI later) and by the Buttons offers.
// Every time DocDelay mentions a slot, it came from checkFreeSlots.

export type BookResult = { ok: true } | { ok: false; reason: string };

// check_free_slots: real EMPTY slots for a doctor that match the query
// (days, time of day, after/before a time). Never a slot that would need
// anyone to move. Today's slots only from the doctor's return time on.
export async function checkFreeSlots(
  doctorId: string,
  query: SlotQuery,
  options: { excludeAppointmentId?: string; todayFrom?: string } = {},
): Promise<SlotOffer[]> {
  const state = await loadState();
  return listFreeSlots(
    state.appointments.filter((a) => a.doctorId === doctorId),
    query,
    options,
  );
}

// book_slot: re-check a slot under ALL the rules, then book it or refuse
// with a reason. It only ever books an EMPTY slot — nobody is ever pushed to
// fit a chosen slot (pushing only happens for a plain "later today" answer
// with no time, through its own rules). If the patient asked for a time
// (`wish`, e.g. "after 4"), the slot must also be within it.
export async function bookSlot(
  appointmentId: string,
  slot: SlotOffer,
  wish?: TimeWish,
): Promise<BookResult> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "book", at: realTimestamp(), appointmentId, ...slot };
  // (The wish only narrows what may be booked, so replaying the saved step
  // later without it gives the same result.)
  const result = applyBook(replay(steps), step, wish);
  if (!result.ok) return result;
  return (await writeSteps([...steps, step]))
    ? result
    : { ok: false, reason: "This demo has too much history. Press “Reset demo”." };
}

function applyBook(
  state: HmsState,
  step: Extract<DemoStep, { kind: "book" }>,
  wish?: TimeWish,
): BookResult {
  const appt = state.appointments.find((a) => a.id === step.appointmentId);
  if (!appt) return { ok: false, reason: "Unknown appointment." };
  const slot = { dayOffset: step.dayOffset, startTime: step.startTime };
  const result = bookSlotIn(state, appt, slot, step.at, wish);
  if (result.ok) {
    appt.callLog = [
      ...(appt.callLog ?? []),
      {
        calledAt: new Date(step.at).toISOString(),
        detail: `Booked ${formatWhen(slot.dayOffset, slot.startTime)}`,
      },
    ];
  }
  return result;
}

// The rules for booking one slot (changes `state`; the caller saves it):
//   - the patient must still be waiting for a new time;
//   - the slot must be one checkFreeSlots would list right now: EMPTY, on an
//     open day, within opening hours, and — today — from the doctor's return
//     time on. So nobody else is ever moved, and if two patients pick the
//     same slot, the first one wins and the second is refused;
//   - if the patient asked for a time (`wish`), the slot must be within it;
//   - a chosen slot must END by NORMAL_DAY_END (5:00 PM). Slots after that are
//     only ever created by the "later today" push, never booked here.
function bookSlotIn(
  state: HmsState,
  appt: Appointment,
  slot: SlotOffer,
  at: number,
  wish?: TimeWish,
): BookResult {
  if (appt.status !== "Affected – needs contact") {
    return { ok: false, reason: "This patient isn't waiting for a new time." };
  }
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return { ok: false, reason: "Unknown doctor unavailability." };

  const free = listFreeSlots(
    state.appointments.filter((a) => a.doctorId === appt.doctorId),
    { days: [slot.dayOffset], ...wish },
    { excludeAppointmentId: appt.id, todayFrom: bookingsStartAt(unavailability) },
  );
  if (!free.some((f) => f.startTime === slot.startTime)) {
    return { ok: false, reason: "That slot isn't free any more (or it's outside the rules)." };
  }

  const today = slot.dayOffset === 0;
  if (toMinutes(slot.startTime) + SLOT_MINUTES > toMinutes(NORMAL_DAY_END)) {
    return { ok: false, reason: "Chosen times must be within normal hours (until 5:00 PM)." };
  }
  moveAppointment(
    state,
    appt,
    slot.dayOffset,
    slot.startTime,
    today ? "Patient chose a later time today" : "Patient chose another day",
    unavailability,
    at,
  );
  appt.status = today ? "Rescheduled – later today" : "Rescheduled – another day";
  delete appt.offers;
  delete appt.offersBecause;
  delete appt.doctorBackLater;
  return { ok: true };
}

// ---------- Chat mode ----------

// A patient's chat message, together with what it was understood to mean
// (the understanding is done BEFORE this, in lib/understanding). Runs the
// conversation one step and saves it. Returns false if nothing happened.
export async function sendChatMessage(
  appointmentId: string,
  text: string,
  understanding: Understanding,
): Promise<boolean> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "chat", at: realTimestamp(), appointmentId, text, understanding };
  if (!applyChat(replay(steps), step)) return false;
  return writeSteps([...steps, step]);
}

// Other-day offers for a chat request:
//   - a NAMED day ("Monday afternoon"): up to 3 slots on that day matching
//     the time ("matched"); if it has none → "day full" (or "day closed") and
//     the NEAREST other days, one per day;
//   - otherwise one per day, earliest days first: "matched" if slots match
//     the time, else "no match" with the closest free slots;
//   - "outside hours": the time is outside clinic hours (e.g. "after 6") →
//     the closest free slots, one per day, from the named day (if any) on.
// An empty list means the doctor has no free slot at all in the coming days.
function chatOffers(
  state: HmsState,
  appt: Appointment,
  wish: Preferences,
): {
  note: "matched" | "day full" | "day closed" | "outside hours" | "no match";
  offers: SlotOffer[];
} {
  const doctorsAppointments = state.appointments.filter((a) => a.doctorId === appt.doctorId);
  const free = (query: SlotQuery) =>
    listFreeSlots(doctorsAppointments, query, { excludeAppointmentId: appt.id });
  const allDays = Array.from({ length: DAYS_TO_SEARCH }, (_, i) => i + 1); // 1 … DAYS_TO_SEARCH
  const day = wish.dayOffset;
  const named = day !== undefined && day > 0 && day <= DAYS_TO_SEARCH ? day : undefined;
  const anchor = anchorTime(wish, originalTimeOf(appt));
  const time = { timeOfDay: wish.timeOfDay, after: wish.after, before: wish.before };

  if (isOutsideClinicHours(time)) {
    const fromDay = allDays.filter((d) => d >= (named ?? 1));
    return { note: "outside hours", offers: pickClosestPerDay(free({ days: fromDay }), anchor) };
  }

  if (named !== undefined) {
    // The named day first: up to 3 slots on it.
    const onDay = isClosedDay(named) ? [] : free({ days: [named], ...time });
    if (onDay.length > 0) return { note: "matched", offers: pickOnDay(onDay, anchor) };
    // Nothing there: the nearest other days, one per day (at the asked time if possible).
    const otherDays = allDays.filter((d) => d !== named);
    const matching = free({ days: otherDays, ...time });
    const pool = matching.length > 0 ? matching : free({ days: otherDays });
    return {
      note: isClosedDay(named) ? "day closed" : "day full",
      offers: pickClosestPerDay(pool, anchor, undefined, named),
    };
  }

  const matching = free({ days: allDays, ...time });
  if (matching.length > 0 && day === undefined) {
    return { note: "matched", offers: pickOffers(matching, anchor) };
  }
  return { note: "no match", offers: pickClosestPerDay(free({ days: allDays }), anchor) };
}

// ---------- Which slots to offer for a wish (shared by the rule-based chat and the AI) ----------

// What happened when looking for slots — decides the wording of the reply.
export type OfferSituation =
  // today (the patient asked for a time TODAY):
  | "today" // empty slots today at the asked time
  | "today, doctor back" // the asked time starts before the doctor is back → slots from the return
  | "nothing before, doctor back" // "before 11", doctor back at 11 → nothing today; other days before 11
  | "none today, doctor back" // asked time starts before the return, nothing free after it
  | "none today" // nothing empty today at the asked time → other days at that time
  // other days (or any day):
  | "matched" // slots match the wish
  | "day full" // the named day has nothing at that time → nearest other days
  | "day closed" // the named day is a closed day → nearest other days
  | "outside hours" // the asked time is outside clinic hours → closest slots, one per day
  | "no match"; // nothing matches → closest slots, one per day

export interface OfferResult {
  situation: OfferSituation;
  offers: SlotOffer[]; // empty = the doctor has no free slot at all in the coming days
  dayOffset?: number; // the day the patient named (for "day full" / "day closed")
  backAt?: string; // the doctor's return time (for the "doctor back" situations)
  endsAt?: string; // the end of the asked time (for "nothing before, doctor back")
}

// The slots to offer for a patient's wish, following ALL the rules in
// reschedulingRules.ts. `today` = the patient asked for a time today.
// Never changes anything (read-only).
function findOffers(
  state: HmsState,
  appt: Appointment,
  wish: Preferences,
  today: boolean,
  days?: number[], // several days to choose from (e.g. "next week, not Monday")
): OfferResult {
  if (!today && days) {
    // One per day across the given days, matching the time if possible.
    const doctorsAppointments = state.appointments.filter((a) => a.doctorId === appt.doctorId);
    const free = (query: SlotQuery) =>
      listFreeSlots(doctorsAppointments, query, { excludeAppointmentId: appt.id });
    const time: TimeWish = { timeOfDay: wish.timeOfDay, after: wish.after, before: wish.before };
    const anchor = anchorTime(time, originalTimeOf(appt));
    if (isOutsideClinicHours(time)) {
      return { situation: "outside hours", offers: pickClosestPerDay(free({ days }), anchor) };
    }
    const matching = free({ days, ...time });
    return matching.length > 0
      ? { situation: "matched", offers: pickOffers(matching, anchor) }
      : { situation: "no match", offers: pickClosestPerDay(free({ days }), anchor) };
  }
  if (!today) {
    const { note, offers } = chatOffers(state, appt, wish);
    return { situation: note, offers, dayOffset: wish.dayOffset };
  }
  const time: TimeWish = { timeOfDay: wish.timeOfDay, after: wish.after, before: wish.before };
  const back = bookingsStartAt(
    state.unavailabilities.find((u) => u.id === appt.unavailabilityId)!,
  );
  const doctorsAppointments = state.appointments.filter((a) => a.doctorId === appt.doctorId);

  // Outside clinic hours ("after 6", "before 8"): the closest slots,
  // one per day, earliest days first (today included).
  if (isOutsideClinicHours(time)) {
    const everyDay = Array.from({ length: DAYS_TO_SEARCH + 1 }, (_, d) => d);
    const free = listFreeSlots(
      doctorsAppointments,
      { days: everyDay },
      { excludeAppointmentId: appt.id, todayFrom: back },
    );
    return {
      situation: "outside hours",
      offers: pickClosestPerDay(free, anchorTime(time, originalTimeOf(appt))),
    };
  }

  // Slots always respect the WHOLE asked time — its start is covered anyway
  // (slots start at the doctor's return), and its end is never passed:
  // "before 11" never offers 11:00 or later.
  const beforeReturn = toMinutes(wishStartsAt(time)) < toMinutes(back);
  const todaySlots = emptySlotsToday(doctorsAppointments, back, time, appt.id);
  if (todaySlots.length > 0) {
    return {
      situation: beforeReturn ? "today, doctor back" : "today",
      offers: todaySlots,
      backAt: back,
    };
  }

  // Nothing empty today: other days at the asked time.
  const { offers } = chatOffers(state, appt, time);
  const endsAt = wishEndsAt(time);
  if (endsAt && toMinutes(back) >= toMinutes(endsAt)) {
    return { situation: "nothing before, doctor back", offers, backAt: back, endsAt };
  }
  return {
    situation: beforeReturn ? "none today, doctor back" : "none today",
    offers,
    backAt: back,
  };
}

// The rule-based chat's reply for an OfferResult, in the patient's language.
function offerText(language: Language, found: OfferResult, doctorName: string): string {
  const { situation, offers, dayOffset, backAt, endsAt } = found;
  const script = (intro?: string) => otherDayOffersScript(language, offers, false, intro);
  switch (situation) {
    case "today":
    case "matched":
      return script();
    case "today, doctor back":
      return script(doctorBackIntro(language, doctorName, backAt!));
    case "outside hours":
      return script(clinicHoursIntro(language));
    case "nothing before, doctor back":
      return `${doctorBackNothingBeforePrefix(language, doctorName, backAt!, endsAt!)} ${script()}`;
    case "none today, doctor back":
      return `${doctorBackNoneTodayPrefix(language, doctorName, backAt!)} ${script()}`;
    case "none today":
      return `${noFreeTodayPrefix(language)} ${script()}`;
    case "day full":
      return `${dayFullPrefix(language, dayOffset!)} ${script()}`;
    case "day closed":
      return `${dayClosedPrefix(language, dayOffset!)} ${script()}`;
    case "no match":
      return `${noMatchPrefix(language)} ${script()}`;
  }
}

// One chat turn. Replies use the existing wording in the patient's language
// and only ever mention slots from checkFreeSlots. Changes `state`.
function applyChat(state: HmsState, step: Extract<DemoStep, { kind: "chat" }>): boolean {
  return chatTurn(state, step, "call");
}

// The conversation itself — the SAME rules for a chat on a call and for
// WhatsApp. Only two things differ on WhatsApp: the lines are kept in the
// appointment's WhatsApp conversation, and the log says "WhatsApp".
// `withOpening` = false leaves out DocDelay's opening message (used when a
// patient changes an answer they already gave).
function chatTurn(
  state: HmsState,
  step: {
    at: number;
    appointmentId: string;
    text: string;
    understanding: Understanding;
    media?: WhatsAppMedia; // WhatsApp only: a voice note or a photo
  },
  channel: Channel,
  withOpening = true,
): boolean {
  const lines = channel === "WhatsApp" ? "whatsapp" : "chat"; // which conversation
  const appt = state.appointments.find((a) => a.id === step.appointmentId);
  if (!appt || appt.status !== "Affected – needs contact") return false;
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return false;

  const patient = patients.find((p) => p.id === appt.patientId)!;
  const doctor = doctors.find((d) => d.id === appt.doctorId)!;
  const language = patient.preferredLanguage;
  const doctorName = doctorNameFor(doctor, language); // e.g. "டாக்டர் மீரா கிருஷ்ணன் (Dr. Meera Krishnan)"
  const when = new Date(step.at).toISOString();
  const u = step.understanding;
  const say = (text: string) => appt[lines]!.push({ at: when, from: "docdelay", text });
  const log = (result: CallResult | undefined, detail: string) =>
    (appt.callLog = [
      ...(appt.callLog ?? []),
      channel === "WhatsApp"
        ? { calledAt: when, channel, result, detail: `WhatsApp: ${detail}` }
        : { calledAt: when, result, detail: `Chat: ${detail}` },
    ]);
  const dropOffers = () => {
    delete appt.offers;
    delete appt.offersBecause;
  };

  // The chat starts with what DocDelay said first.
  if (!appt[lines]?.length) {
    appt[lines] = [];
    if (withOpening) say(openingLine(state, appt, unavailability, channel));
  }
  appt[lines].push({
    at: when,
    from: "patient",
    text: step.text,
    understood: step.media === "photo" ? PHOTO_NOT_READ : describeUnderstanding(u),
    ...(step.media ? { media: step.media } : {}),
  });

  // Couldn't understand: ask again once; the second time in a row, hand over to staff.
  const unclear = () => {
    appt.unclearInARow = (appt.unclearInARow ?? 0) + 1;
    if (appt.unclearInARow >= 2) {
      appt.status = "Needs staff call";
      appt.note = "Couldn't understand";
      dropOffers();
      say(staffWillCallReply(language));
      log("Needs staff call", "couldn't understand 2 replies in a row");
    } else {
      // A voice note or a photo gets its own line ("…please type your answer…").
      say(
        step.media
          ? couldntUnderstandReply(language)
          : unclearReply(language, Boolean(appt.offers)),
      );
    }
    return true;
  };
  if (u.intent !== "unclear") appt.unclearInARow = 0;

  // A time given earlier without a day ("after 4") is used with the answer to
  // "today, or another day?" — unless the new message names a time itself.
  const timeOf = (p: Preferences): TimeWish | undefined =>
    p.timeOfDay || p.after || p.before
      ? { timeOfDay: p.timeOfDay, after: p.after, before: p.before }
      : undefined;
  const prefs: Preferences = timeOf(u.preferences)
    ? u.preferences
    : { ...u.preferences, ...appt.timeWish };
  if (u.intent !== "unclear" && u.intent !== "time_without_day") delete appt.timeWish;

  switch (u.intent) {
    // SAFETY: any health concern stops rescheduling at once. Nothing is
    // booked, reserved or prioritised; any later rebooking follows the normal rules.
    case "health_concern":
      appt.status = "URGENT – staff call now";
      dropOffers();
      say(urgentReply(language));
      log(undefined, "health concern mentioned → URGENT staff call");
      return true;

    case "talk_to_person":
      appt.status = "Needs staff call";
      appt.note = !appt.offers
        ? "Asked to talk to a person"
        : appt.offersBecause === "another doctor"
          ? "Wanted another doctor today"
          : "Wants a different day";
      dropOffers();
      say(staffWillCallReply(language));
      log("Needs staff call", appt.note);
      return true;

    case "cancel":
      appt.status = "Cancelled";
      dropOffers();
      say(cancelledReply(language));
      log("Cancelled", "cancelled");
      return true;

    // A time but no day — don't guess: ask. (Not an "unclear" reply.)
    case "time_without_day":
      appt.timeWish = timeOf(u.preferences);
      say(askTodayOrAnotherDay(language));
      return true;

    case "later_today": {
      const todayWish = timeOf(prefs); // e.g. "after 4" → only at or after 4 PM

      // A SPECIFIC time today: offer up to 3 EMPTY slots (A/B/C) and let the
      // patient pick — nobody is ever pushed to fit a chosen time (see
      // reschedulingRules.ts). Picking one books it through bookSlotIn.
      if (todayWish) {
        const found = findOffers(state, appt, todayWish, true);
        if (found.offers.length === 0) {
          appt.status = "Needs staff call";
          appt.note = "No free slot in the next days";
          dropOffers();
          say(staffWillCallReply(language));
          return true;
        }
        appt.offers = found.offers;
        appt.offersBecause = "asked";
        say(offerText(language, found, doctorName));
        log("Wants later today", found.situation);
        return true;
      }

      // A plain "later today" / "I'll wait" with no time: the existing rules
      // (empty slot first, then the push with the 45-minute cap and 7 PM limit).
      if (appt.offers && appt.offersBecause === "no room today") {
        // Today is still full — repeat the other-day offers.
        say(otherDayOffersScript(language, appt.offers, true));
        return true;
      }
      const noRoomBecause = rescheduleLaterToday(state, appt, step.at);
      if (!noRoomBecause) {
        dropOffers();
        say(laterTodayReply(language, appt.startTime));
        log("Wants later today", `new time ${formatTime(appt.startTime)} today`);
        return true;
      }
      log("Wants later today", `No room today: ${noRoomBecause}`);
      offerOtherDays(state, appt, "no room today");
      say(
        appt.offers
          ? otherDayOffersScript(language, appt.offers, true)
          : staffWillCallReply(language),
      );
      return true;
    }

    case "another_day": {
      const found = findOffers(state, appt, prefs, false);
      if (found.offers.length === 0) {
        appt.status = "Needs staff call";
        appt.note = "No free slot in the next days";
        dropOffers();
        say(staffWillCallReply(language));
        log("Wants another day", "no free slot in the next days");
        return true;
      }
      appt.offers = found.offers;
      appt.offersBecause = "asked";
      say(offerText(language, found, doctorName));
      return true;
    }

    // See another doctor of the same specialty today: up to 3 EMPTY slots with
    // an approved doctor (the same rules as "5 – Another doctor today").
    case "another_doctor": {
      const slots = anotherDoctorSlotsIn(state, appt);
      if (slots.length === 0) {
        dropOffers();
        say(noOtherDoctorFreeReply(language));
        log("Wants another doctor today", "no other doctor free today");
        return true;
      }
      appt.offers = slots;
      appt.offersBecause = "another doctor";
      say(anotherDoctorOffersText(language, slots));
      log("Wants another doctor today", `offered ${slots.map((o) => formatTime(o.startTime)).join(" / ")}`);
      return true;
    }

    case "choose_offer": {
      const offer = u.offerIndex !== undefined ? appt.offers?.[u.offerIndex] : undefined;
      if (!offer) return unclear();

      // A slot with another doctor: book it (re-checked). If it was taken
      // meanwhile: "Sorry, that time was just taken" and fresh options — or,
      // with none left, the question about the other choices.
      if (appt.offersBecause === "another doctor") {
        if (bookWithAnotherDoctor(state, appt, offer, step.at)) {
          const newDoctor = doctors.find((d) => d.id === offer.doctorId)!;
          say(anotherDoctorReply(language, offer.startTime, doctorNameFor(newDoctor, language)));
          log(
            "Wants another doctor today",
            `picked ${OFFER_LETTERS[u.offerIndex!]}: ${formatTime(offer.startTime)} with ${newDoctor.name}`,
          );
          return true;
        }
        const fresh = anotherDoctorSlotsIn(state, appt);
        // "…just taken", or the real reason if that doctor is away at that time.
        const sorry = refusedPrefix(state, language, offer.doctorId!, offer);
        if (fresh.length > 0) {
          appt.offers = fresh;
          say(`${sorry} ${anotherDoctorOffersText(language, fresh)}`);
        } else {
          dropOffers();
          say(`${sorry} ${noOtherDoctorFreeReply(language)}`);
        }
        log("Wants another doctor today", "picked slot was just taken");
        return true;
      }

      if (bookSlotIn(state, appt, offer, step.at).ok) {
        say(
          offer.dayOffset === 0
            ? laterTodayReply(language, offer.startTime)
            : anotherDayReply(language, offer.dayOffset, offer.startTime),
        );
        log(
          "Wants another day",
          `picked ${OFFER_LETTERS[u.offerIndex!]}: ${formatWhen(offer.dayOffset, offer.startTime)}`,
        );
        return true;
      }
      // Taken meanwhile — first one wins; this patient gets fresh options.
      // (Or the doctor's return time is now later than the slot: then the
      // line says so. Only the line differs.)
      const sorry = refusedPrefix(state, language, appt.doctorId, offer);
      offerOtherDays(state, appt, appt.offersBecause === "no room today" ? "no room today" : "asked");
      say(
        `${sorry} ${
          appt.offers
            ? otherDayOffersScript(language, appt.offers, false)
            : staffWillCallReply(language)
        }`,
      );
      return true;
    }

    default:
      return unclear();
  }
}

// What DocDelay said first in a chat: the call script (with "Press 5 to see
// another doctor…" only when an approved doctor has a free slot) — or, if the
// patient was already looking at offers (e.g. from Buttons mode), those offers.
// On WhatsApp: the WhatsApp wording (whatsappScript) — wording only, nothing else changes.
function openingLine(
  state: HmsState,
  appt: Appointment,
  unavailability: Unavailability,
  channel: Channel = "call",
): string {
  const patient = patients.find((p) => p.id === appt.patientId)!;
  const doctor = doctors.find((d) => d.id === appt.doctorId)!;
  const language = patient.preferredLanguage;
  if (appt.offers) {
    return appt.offersBecause === "another doctor"
      ? anotherDoctorOffersText(language, appt.offers)
      : otherDayOffersScript(language, appt.offers, appt.offersBecause === "no room today");
  }
  const details = {
    language,
    patientName: patient.name,
    hospitalName: hospital.name,
    doctorName: doctorNameFor(doctor, language),
    reason: unavailability.reason,
    appointmentTime: appt.startTime,
    untilTime: bookingsStartAt(unavailability),
    anotherDoctorToday: anotherDoctorSlotsIn(state, appt).length > 0,
  };
  return channel === "WhatsApp" ? whatsappScript(details) : callScript(details);
}

// ---------- WhatsApp (simulated) ----------
// A second way to reach DocDelay, alongside calls and texts. Nothing is really
// sent or received. The rules:
//   - Only "WhatsApp OK" patients use it. "STOP" (the whole message, any
//     letter case) closes the WhatsApp chat for that appointment; calls go on.
//   - The HEALTH CHECK runs first on EVERY message, whatever the patient's
//     status: any health mention → URGENT, exactly as in chat.
//     EXCEPTION: a patient who sent STOP, or isn't "WhatsApp OK", only gets
//     the fixed emergency line (no URGENT, no staff note); anything else they
//     send is ignored.
//   - A patient who hasn't answered yet answers exactly as in chat (chatTurn).
//   - LAST FINISHED ANSWER WINS: a patient who already answered can change
//     their answer. It's a fresh answer, re-checked against every rule in
//     reschedulingRules.ts. Their old booking stays until the new answer is
//     finished, then it's freed. Patients pushed for the earlier answer stay
//     where they are. At most MAX_ANSWER_CHANGES changes; one more attempt →
//     "Needs staff call – Keeps changing", and nothing changes.
//   - After an update was sent, "1" = confirmed and "2" = show the choices.
//   - PUSHED patients (time moved, not affected) answer their heads-up:
//     1 / "ok" = fine; 2 / cancel wording = "Reply YES to cancel" (cancelled
//     only on YES); 3, another day or anything else = front desk, booking kept.
//   - VOICE NOTES are turned into text (in the demo, the visitor types it) and
//     then go through exactly the same steps as a typed message — health
//     check first — with ONE difference: a voice note can never be "STOP"
//     (speech-to-text can mishear words). If it's unclear, the patient gets
//     "Sorry, I couldn't understand that. Please type your answer…".
//   - PHOTOS (and documents, stickers) are never read — so never health-
//     checked either. The patient gets the same "Sorry…" line and staff get a
//     note in the log (no alert). Like any reply DocDelay can't read, a photo
//     counts towards "two unclear replies → staff call", and only before the
//     patient has answered. It never makes anyone URGENT.
//   - A message DocDelay couldn't understand (typed, voice note or photo)
//     never moves a patient to the end of the call queue: only a reply
//     DocDelay understood does.
//   - A PUSHED patient's voice note that says "stop" (English, Tamil or
//     Hindi) and nothing else DocDelay can read gets only the "Sorry…" line —
//     no staff call, and an open "Reply YES to cancel" question stays open.
// WhatsApp uses the rule-based understanding only (never the AI).

export const MAX_ANSWER_CHANGES = 2;

// What staff see under a photo: DocDelay didn't look at it.
const PHOTO_NOT_READ = "photo — not read";

// "Stop" words, for a PUSHED patient's voice note only (see applyWhatsApp).
// They never close the chat — only a TYPED "STOP" does.
// ⚠️ Tamil and Hindi: NOT yet native-checked (BACKLOG.md).
// Not here: "ruko" / "rukiye" — they also mean "wait", and the chat
// understanding already reads them as "I'll wait" (a pushed patient who
// says that goes to the front desk, as before).
const STOP_WORDS_LATIN = [
  "stop", // English
  "niruthu", // Tamil: stop (it)
  "niruthunga", // Tamil: please stop
  "niruthidunga", // Tamil: please stop (it)
  "band karo", // Hindi: stop it / switch it off
  "band kar do", // Hindi: stop it
  "band kijiye", // Hindi: please stop it (polite)
];
const STOP_WORDS_SCRIPT = [
  "நிறுத்து", // niruthu — also matches niruthunga ("நிறுத்துங்க")
  "நிறுத்தி", // matches niruthidunga ("நிறுத்திடுங்க")
  "बंद करो", // band karo
  "बंद कर दो", // band kar do
  "बंद कीजिए", // band kijiye
];
// Does a voice note's text contain a "stop" word? (Whole words for English
// letters, so "stopped" or "bandage" don't count.)
function saysStop(text: string): boolean {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim()} `;
  return (
    STOP_WORDS_LATIN.some((w) => t.includes(` ${w} `)) ||
    STOP_WORDS_SCRIPT.some((w) => text.includes(w))
  );
}

// A finished answer that WhatsApp can change.
const ANSWERED: AppointmentStatus[] = [
  "Rescheduled – later today",
  "Rescheduled – another day",
  "Rebooked – another doctor",
  "Cancelled",
];

// What happened to a WhatsApp message.
export type WhatsAppResult =
  | "ignored" // nothing happened (and nothing was saved)
  | "emergency line" // health mention, WhatsApp off → only the fixed emergency line
  | "urgent" // health mention → URGENT staff call
  | "stopped" // "STOP" → WhatsApp off for this appointment
  | "confirmed" // "1" after an update
  | "menu" // "2" after an update → the choices were shown
  | "replied" // DocDelay answered; nothing was decided
  | "answered" // the patient's first answer is finished (or handed to staff)
  | "changed" // a finished answer was changed
  | "same slot" // they picked what they already have — not counted as a change
  | "staff" // handed to staff (asked for a person, no free slot, or a heads-up reply)
  | "fine" // heads-up: "1" / "ok" — nothing changed
  | "cancel asked" // heads-up: asked "Reply YES to cancel" — nothing cancelled yet
  | "cancelled" // heads-up: cancelled after YES
  | "keeps changing"; // one change too many → staff call, nothing changed

// A WhatsApp message from a patient about one appointment. Works out what it
// means (rule-based), runs the conversation one step and saves it.
// `media`: "voice" = `message` is what was heard in a voice note;
//          "photo" = a photo (`message` is not used — photos are never read).
export async function sendWhatsAppMessage(
  appointmentId: string,
  message: string,
  media?: WhatsAppMedia,
): Promise<WhatsAppResult> {
  const steps = await readSteps();
  const state = replay(steps);
  const appt = state.appointments.find((a) => a.id === appointmentId);
  const text = media === "photo" ? "" : message.slice(0, MAX_CHAT_TEXT);
  if (!appt || (media !== "photo" && !text.trim())) return "ignored";
  const patient = patients.find((p) => p.id === appt.patientId)!;
  // Understood from the WHOLE message (health words first), then saved with
  // the step — so rebuilding the demo never has to work it out again.
  // A photo has no words: it is always "couldn't understand".
  const understanding: Understanding =
    media === "photo"
      ? { intent: "unclear", preferences: {} }
      : await interpretWithRules(text, {
          language: patient.preferredLanguage,
          offers: appt.change?.offers ?? appt.offers ?? [],
        });
  const step: Extract<DemoStep, { kind: "whatsapp" }> = {
    kind: "whatsapp",
    at: realTimestamp(),
    appointmentId,
    text,
    understanding,
    ...(media ? { media } : {}),
  };
  const result = applyWhatsApp(state, step);
  if (result === "ignored") return result;
  return (await writeSteps([...steps, step])) ? result : "ignored";
}

// What DocDelay says about the booking a patient has right now.
function bookingLine(appt: Appointment, language: Language): string {
  if (appt.status === "Cancelled") return cancelledReply(language);
  if (appt.status === "Rebooked – another doctor") {
    const doctor = doctors.find((d) => d.id === appt.doctorId)!;
    return anotherDoctorReply(language, appt.startTime, doctorNameFor(doctor, language));
  }
  return appt.dayOffset === 0
    ? laterTodayReply(language, appt.startTime)
    : anotherDayReply(language, appt.dayOffset, appt.startTime);
}

function applyWhatsApp(
  state: HmsState,
  step: Extract<DemoStep, { kind: "whatsapp" }>,
): WhatsAppResult {
  const appt = state.appointments.find((a) => a.id === step.appointmentId);
  // Only appointments DocDelay has contacted: affected ones, and pushed ones.
  if (!appt || !(appt.unavailabilityId || appt.timeHistory?.length)) return "ignored";
  const patient = patients.find((p) => p.id === appt.patientId)!;
  const language = patient.preferredLanguage;
  const when = new Date(step.at).toISOString();
  const u = step.understanding;
  const typed = step.text.trim().toLowerCase();
  const media = step.media; // a voice note or a photo; undefined = typed
  // Is WhatsApp on for this patient and this appointment?
  const whatsAppOn = patient.whatsappOptIn === true && !appt.whatsappStopped;

  // Add the patient's message / DocDelay's reply to the WhatsApp conversation.
  const hear = (understood: string) =>
    (appt.whatsapp = [
      ...(appt.whatsapp ?? []),
      { at: when, from: "patient", text: step.text, understood, ...(media ? { media } : {}) },
    ]);
  // The reply to a voice note or photo DocDelay couldn't understand.
  const sorry = () => say(couldntUnderstandReply(language));
  const say = (text: string) => appt.whatsapp!.push({ at: when, from: "docdelay", text });
  const log = (result: CallResult | undefined, detail: string) =>
    (appt.callLog = [
      ...(appt.callLog ?? []),
      { calledAt: when, channel: "WhatsApp", result, detail: `WhatsApp: ${detail}` },
    ]);
  const toStaff = (note: string, detail: string): void => {
    appt.status = "Needs staff call";
    appt.note = note;
    delete appt.change;
    say(staffWillCallReply(language));
    log("Needs staff call", detail);
  };

  // 1. SAFETY — the health check, before anything else, on every message.
  if (mentionsHealth(step.text) || u.intent === "health_concern") {
    if (!whatsAppOn) {
      // The exception: only the fixed emergency line. No URGENT, no staff note.
      hear("health concern → emergency line only (WhatsApp is off for this patient)");
      say(emergencyOnlyReply(language));
      return "emergency line";
    }
    hear(describeUnderstanding({ intent: "health_concern", preferences: {} }));
    if (appt.status !== "URGENT – staff call now") {
      // Remember a finished answer's status, so a false alarm puts it back.
      if (appt.status !== "Affected – needs contact") appt.statusBeforeUrgent = appt.status;
      appt.status = "URGENT – staff call now";
    }
    // Nothing is booked, reserved, moved or cancelled.
    delete appt.offers;
    delete appt.offersBecause;
    delete appt.change;
    delete appt.whatsappStarted;
    delete appt.headsUpCancelAsked;
    say(urgentReply(language));
    log(undefined, "health concern mentioned → URGENT staff call");
    return "urgent";
  }

  // 2. WhatsApp is off for this patient: everything else is ignored.
  if (!whatsAppOn) return "ignored";

  // 3. STOP (must be the whole message): no more WhatsApp for this
  //    appointment — no replies, and any update goes by SMS. Calls continue.
  //    Only a TYPED "STOP" counts: a voice note that says "stop" is handled
  //    like any other voice note below.
  if (typed === "stop" && !media) {
    hear("STOP → WhatsApp off for this appointment");
    appt.whatsappStopped = true;
    delete appt.change;
    delete appt.whatsappStarted;
    log(undefined, "STOP — WhatsApp turned off for this appointment; calls continue");
    return "stopped";
  }

  // A PUSHED patient (time moved, not affected): their replies are read
  // against the heads-up they were sent — never against the main menu.
  if (!appt.unavailabilityId) {
    if (!appt.headsUpSent) return "ignored"; // nothing was sent to reply to
    if (appt.status === "Cancelled") {
      hear("already cancelled");
      say(cancelledReply(language));
      return "replied";
    }
    if (appt.status !== "Time moved") {
      // Already with staff.
      hear(describeUnderstanding(u));
      say(staffWillCallReply(language));
      return "replied";
    }
    // A photo can't be read: nothing changes (and the "YES to cancel"
    // question, if open, stays open).
    if (media === "photo") {
      hear(PHOTO_NOT_READ);
      sorry();
      log(undefined, "photo received — not read");
      return "replied";
    }
    const reading = readHeadsUpReply(step.text, u.intent === "cancel");

    // A VOICE NOTE that says "stop" (in any of the 3 languages) and nothing
    // DocDelay can read: it is NOT a STOP (only a typed STOP is), and it's no
    // reason for a staff call either. Only the "Sorry…" line, like a photo:
    // the booking stays, and an open "Reply YES to cancel" question stays
    // open. (Clear wording in the same voice note — "can't come", "cancel" —
    // is read as usual below.)
    if (
      media === "voice" &&
      reading === "other" &&
      u.intent === "unclear" &&
      saysStop(step.text)
    ) {
      hear(describeUnderstanding(u));
      sorry();
      return "replied";
    }

    const wasAsked = appt.headsUpCancelAsked === true;
    delete appt.headsUpCancelAsked; // the question is only open for ONE reply

    // Cancelled ONLY by "YES" straight after the question. The slot is freed
    // (cancelled appointments don't hold one) and nobody else moves.
    if (wasAsked && reading === "yes") {
      hear("YES → cancel");
      appt.status = "Cancelled";
      state.pendingUpdates = state.pendingUpdates.filter((x) => x.appointmentId !== appt.id);
      say(cancelledReply(language));
      log("Cancelled", "cancelled after the heads-up (confirmed with YES)");
      return "cancelled";
    }
    if (reading === "cancel") {
      hear("wants to cancel — asked to confirm with YES");
      appt.headsUpCancelAsked = true;
      say(headsUpCancelQuestion(language, appt.startTime));
      return "cancel asked";
    }
    // "1" / "ok" — or "no" to the cancel question: the booking stays.
    if (reading === "fine" || reading === "yes" || (wasAsked && reading === "no")) {
      hear(wasAsked ? "not cancelled — booking kept" : "fine with the new time");
      say(headsUpFineReply(language, appt.startTime));
      return "fine";
    }
    // "3", another day, "don't cancel", or anything else: the front desk
    // calls. The booking stays exactly as it is.
    hear(describeUnderstanding(u));
    appt.status = "Needs staff call";
    appt.note = "Replied to heads-up";
    say(headsUpStaffReply(language));
    log("Needs staff call", "replied to the heads-up — booking kept");
    return "staff";
  }

  // Staff's note for a photo: a line in the log, never an alert.
  if (media === "photo") log(undefined, "photo received — not read");

  // 4. Not answered yet: the same conversation as a chat on a call.
  if (!ANSWERED.includes(appt.status)) {
    // Already with staff: WhatsApp can't undo that.
    if (appt.status === "Needs staff call" || appt.status === "URGENT – staff call now") {
      hear(media === "photo" ? PHOTO_NOT_READ : describeUnderstanding(u));
      say(staffWillCallReply(language));
      return "replied";
    }
    // Didn't pick up the call: they can still answer here (a first answer).
    if (appt.status === "No answer") {
      if (u.intent === "unclear") {
        hear(media === "photo" ? PHOTO_NOT_READ : describeUnderstanding(u));
        if (media) sorry();
        else say(unclearReply(language, false));
        return "replied";
      }
      appt.status = "Affected – needs contact";
    }
    if (!chatTurn(state, step, "WhatsApp")) return "ignored";
    if (appt.status === "Affected – needs contact") {
      // Not finished → end of the call queue. But anything DocDelay couldn't
      // understand (typed, a voice note or a photo) isn't the start of an
      // answer: the patient keeps their place in the queue.
      if (u.intent !== "unclear") appt.whatsappStarted = true;
      return "replied";
    }
    delete appt.whatsappStarted;
    if (ANSWERED.includes(appt.status)) appt.answeredVia = "WhatsApp";
    return "answered";
  }

  // 5. Already answered.
  // After an update ("Reply 1 to confirm, 2 to change"), 1 and 2 are answers
  // to THAT message — never the menu, where 1 means "later today".
  if (appt.awaitingUpdateReply && !appt.change) {
    if (typed === "1") {
      hear("confirmed the update");
      say(bookingLine(appt, language));
      log(undefined, "confirmed the update");
      return "confirmed";
    }
    if (typed === "2") {
      // Only shows the choices. Not a change until they pick one.
      hear("wants to change — choices shown");
      delete appt.awaitingUpdateReply;
      appt.change = {};
      say(changeMenuReply(language));
      return "menu";
    }
  }

  if (u.intent === "talk_to_person") {
    hear(describeUnderstanding(u));
    toStaff("Asked to talk to a person", "Asked to talk to a person");
    return "staff";
  }

  // Is this message a request to change the answer? (Picking a letter only
  // counts if those offers were really made.)
  const picksAnOffer =
    u.intent === "choose_offer" &&
    u.offerIndex !== undefined &&
    Boolean(appt.change?.offers?.[u.offerIndex]);
  const asksForChange =
    picksAnOffer ||
    ["later_today", "another_day", "another_doctor", "cancel", "time_without_day"].includes(
      u.intent,
    );
  if (!asksForChange) {
    // "ok thanks" and the like: repeat their booking. Not counted as a change,
    // and never handed to staff. (An unclear voice note, or a photo, gets the
    // "Sorry, I couldn't understand that…" line instead.)
    hear(media === "photo" ? PHOTO_NOT_READ : describeUnderstanding(u));
    if (media && u.intent === "unclear") sorry();
    else say(bookingLine(appt, language));
    return "replied";
  }

  // Try the new answer on a throw-away copy, as a FRESH answer: the patient is
  // "waiting for a new time" again, with their first doctor, so every existing
  // rule (and its checks) runs as usual. Their current slot counts as empty
  // for them, because they would be leaving it.
  const unavailability = state.unavailabilities.find((x) => x.id === appt.unavailabilityId);
  if (!unavailability) return "ignored";
  const before = {
    status: appt.status,
    doctorId: appt.doctorId,
    dayOffset: appt.dayOffset,
    startTime: appt.startTime,
  };
  const copy = structuredClone(state);
  const trial = copy.appointments.find((a) => a.id === appt.id)!;
  trial.status = "Affected – needs contact";
  trial.doctorId = unavailability.doctorId;
  if (trial.change?.offers) {
    trial.offers = trial.change.offers;
    trial.offersBecause = trial.change.offersBecause;
  }
  if (trial.change?.timeWish) trial.timeWish = trial.change.timeWish;
  delete trial.change;
  if (!chatTurn(copy, step, "WhatsApp", false)) return "ignored";

  const outcome = trial.status as AppointmentStatus; // what the new answer led to
  const finished = outcome !== "Affected – needs contact";
  const cancelled = outcome === "Cancelled";
  const sameAsBefore = cancelled
    ? before.status === "Cancelled"
    : ANSWERED.includes(outcome) &&
      before.status !== "Cancelled" &&
      trial.doctorId === before.doctorId &&
      trial.dayOffset === before.dayOffset &&
      trial.startTime === before.startTime;

  // The slot (or cancellation) they already have: nothing changes, not counted.
  if (sameAsBefore) {
    hear(describeUnderstanding(u));
    delete appt.change;
    say(bookingLine(appt, language));
    return "same slot";
  }

  // One change too many: staff take over, and nothing is changed.
  if ((appt.answerChanges ?? 0) >= MAX_ANSWER_CHANGES && outcome !== "Needs staff call") {
    hear(describeUnderstanding(u));
    toStaff(
      "Keeps changing",
      `keeps changing — change attempt ${MAX_ANSWER_CHANGES + 1}, nothing was changed`,
    );
    return "keeps changing";
  }

  // Keep what happened on the copy.
  state.appointments = copy.appointments;
  state.pendingUpdates = copy.pendingUpdates;

  if (!finished) {
    // Offers were made (or a question asked): remember them, and keep the
    // booking exactly as it was until the new answer is finished.
    trial.change = {
      ...(trial.offers ? { offers: trial.offers, offersBecause: trial.offersBecause } : {}),
      ...(trial.timeWish ? { timeWish: trial.timeWish } : {}),
    };
    delete trial.offers;
    delete trial.offersBecause;
    delete trial.timeWish;
    trial.status = before.status;
    trial.doctorId = before.doctorId;
    return "replied";
  }

  if (outcome === "Needs staff call") {
    // E.g. no free slot anywhere: staff will call; the booking is untouched.
    trial.doctorId = before.doctorId;
    return "staff";
  }

  // A finished, different answer: it replaces the old one.
  trial.answerChanges = (trial.answerChanges ?? 0) + 1;
  trial.answeredVia = "WhatsApp";
  delete trial.awaitingUpdateReply; // a new update will be made for the new time
  if (cancelled) {
    // The old slot is free again (cancelled appointments don't hold a slot),
    // and an update that hasn't been sent yet must not go out with the old time.
    trial.doctorId = before.doctorId;
    state.pendingUpdates = state.pendingUpdates.filter((x) => x.appointmentId !== trial.id);
  } else if (before.doctorId !== unavailability.doctorId) {
    // They were with a covering doctor: say so in the time history, so the
    // "was → now" line and the update message name the right doctors.
    const history = trial.timeHistory!;
    const last = history.at(-1)!;
    if (trial.doctorId !== before.doctorId) {
      last.oldDoctorId = before.doctorId;
      last.newDoctorId = trial.doctorId;
    } else {
      delete last.oldDoctorId;
      delete last.newDoctorId;
    }
  }
  // The very first booking was with the unavailable doctor — keep that on the
  // first line of the history (the screens read it from there).
  const first = trial.timeHistory?.[0];
  if (first && !first.oldDoctorId) {
    first.oldDoctorId = unavailability.doctorId;
    first.newDoctorId ??= unavailability.doctorId;
  }
  trial.callLog = [
    ...(trial.callLog ?? []),
    {
      calledAt: when,
      channel: "WhatsApp",
      detail:
        `WhatsApp: changed answer (${trial.answerChanges} of ${MAX_ANSWER_CHANGES}) — was ` +
        `${before.status === "Cancelled" ? "cancelled" : formatWhen(before.dayOffset, before.startTime)}`,
    },
  ];
  return "changed";
}

// ---------- AI chat (Claude) ----------
// The AI only TALKS; the hms module DECIDES. Each AI turn gets a private copy
// of the visitor's demo. The AI's tools read slots (the same offer rules as the
// rule-based chat — findOffers) and TRY outcomes on that copy, with the same
// booking rules as everywhere else (bookSlotIn, the push rules for a plain
// "later today"). Nothing is saved until the turn is finished and its reply
// has been checked (lib/understanding/aiChat.ts); then it's saved as ONE
// "ai" step, which replaying applies again with the same rules.

// The tools the AI can use (their descriptions for the AI are in lib/understanding/claude.ts).
export const AI_TOOL_NAMES = [
  "check_free_slots",
  "book_slot",
  "wait_later_today",
  "cancel_appointment",
  "hand_to_staff",
  "escalate_urgent",
  "cannot_understand",
  "check_another_doctor_slots",
  "book_with_another_doctor",
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];

// A slot as shown to the AI: `say` is exactly how to write it to the patient.
export interface AiSlot {
  option: string; // "A", "B", "C"
  day_offset: number;
  start_time: string; // "HH:MM"
  say: string; // e.g. "Mon 28 Sep, 4:00 PM" or "செப்டம்பர் 28, திங்கள், மாலை 4:00 (4:00 PM)"
}

// EVERYTHING the AI is told about the patient and the situation. Only the
// patient's FIRST name — never their full name or phone number.
export interface AiTurnContext {
  firstName: string;
  language: Language;
  reason: UnavailabilityReason;
  originalTimeSay: string; // their original appointment time, in their language
  doctorNameSay: string; // e.g. "डॉ. मीरा कृष्णन (Dr. Meera Krishnan)"
  doctorBackSay: string; // when the doctor is expected back
  calendar: { day_offset: number; date: string; closed: boolean }[]; // today … +7 days
  currentOffers: AiSlot[]; // offers the patient is already looking at
  history: { from: "patient" | "docdelay"; text: string }[]; // earlier chat (without the opening)
}

export interface AiTurn {
  context: AiTurnContext;
  runTool(name: AiToolName, input: Record<string, unknown>): Record<string, unknown>;
  allowedTimes(): Set<string>; // "HH:MM" times the reply may mention
  outcome(): AiAction | undefined;
  notUnderstood(): boolean; // the AI said it couldn't understand this message
  // A picked slot was refused because the doctor is now back later: DocDelay's
  // fixed "Sorry, Dr. … will now be back at …" line, which goes in front of
  // the AI's reply (undefined if that didn't happen in this turn).
  refusalLine(): string | undefined;
  save(text: string, reply: string): Promise<boolean>;
}

const STAFF_NOTES: Record<StaffReason, string> = {
  asked_for_person: "Asked to talk to a person",
  could_not_understand: "Couldn't understand",
  no_suitable_time: "No suitable time",
};

// English explanation of what check_free_slots found, for the AI.
function explainForAi(found: OfferResult): string {
  const back = found.backAt ? formatTime(found.backAt) : "";
  const end = found.endsAt ? formatTime(found.endsAt) : "";
  const day =
    found.dayOffset !== undefined && found.dayOffset > 0 ? formatDate(found.dayOffset) : "";
  if (found.offers.length === 0) {
    return "No free slots at all in the coming days. Call hand_to_staff with reason no_suitable_time.";
  }
  return {
    today: "Empty slots today at the asked time.",
    "today, doctor back": `The doctor is back at ${back}, so these are the earliest empty slots today. Say that first.`,
    "nothing before, doctor back": `The doctor is back at ${back}, so nothing is free before ${end} today. Say that, then offer these other days (before ${end}).`,
    "none today, doctor back": `The doctor is back at ${back}, but nothing is free today after that. Say that, then offer these other days.`,
    "none today":
      "Nothing is free today at that time. Say that, then offer these other days at that time.",
    matched: "These slots match the request.",
    "day full": `${day} is full at that time. Say that, then offer these nearest other days.`,
    "day closed": `The clinic is closed on ${day}. Say that, then offer these nearest other days.`,
    "outside hours": `That time is outside clinic hours (${formatTime(DAY_START)} to ${formatTime(NORMAL_DAY_END)}). Say that, then offer these closest slots.`,
    "no match": "Nothing matches exactly. Say that, then offer these closest slots.",
  }[found.situation];
}

// Start an AI turn for a patient who is waiting for a new time.
// Returns undefined if the patient isn't in a call any more.
export async function startAiTurn(appointmentId: string): Promise<AiTurn | undefined> {
  const steps = await readSteps();
  const state = replay(steps);
  const appt = state.appointments.find((a) => a.id === appointmentId);
  if (!appt || appt.status !== "Affected – needs contact") return undefined;
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return undefined;

  const patient = patients.find((p) => p.id === appt.patientId)!;
  const doctor = doctors.find((d) => d.id === appt.doctorId)!;
  const language = patient.preferredLanguage;
  const at = realTimestamp(); // this turn's time — used again when it's replayed
  // How a slot is written to the patient; a slot with another doctor starts
  // with that doctor's name ("Dr. Karthik Raman, today, 9:30 AM").
  const say = (o: SlotOffer) => {
    const when = `${dayLabelFor(o.dayOffset, language)}, ${formatTimeFor(o.startTime, language)}`;
    const other = o.doctorId && doctors.find((d) => d.id === o.doctorId);
    return other ? `${doctorNameFor(other, language)}, ${when}` : when;
  };
  const toAiSlots = (offers: SlotOffer[]): AiSlot[] =>
    offers.map((o, i) => ({
      option: OFFER_LETTERS[i],
      day_offset: o.dayOffset,
      start_time: o.startTime,
      say: say(o),
    }));

  const offered: SlotOffer[] = []; // slots offered in this turn
  let outcome: AiAction | undefined; // at most one per turn
  let unclear = false; // the AI couldn't understand this message
  let refusalLine: string | undefined; // see AiTurn.refusalLine
  const times = new Set<string>([
    originalTimeOf(appt),
    bookingsStartAt(unavailability),
    DAY_START,
    NORMAL_DAY_END,
    ...(appt.offers ?? []).map((o) => o.startTime),
  ]);
  // Try something on a throw-away copy, so a failed attempt changes nothing.
  const onCopy = <T>(fn: (copyState: HmsState, copyAppt: Appointment) => T): T => {
    const copyState = structuredClone(state);
    return fn(
      copyState,
      copyState.appointments.find((a) => a.id === appt.id)!,
    );
  };
  const alreadyDone = { ok: false, reason: "An outcome was already recorded in this turn." };
  const timeOrUndefined = (v: unknown) => (typeof v === "string" && isValidTime(v) ? v : undefined);

  const tools: Record<AiToolName, (input: Record<string, unknown>) => Record<string, unknown>> = {
    check_free_slots(input) {
      const days = Array.isArray(input.days)
        ? input.days.filter(
            (d): d is number => Number.isInteger(d) && d >= 1 && d <= DAYS_TO_SEARCH,
          )
        : [];
      const timeOfDay = ["morning", "afternoon", "evening"].includes(String(input.time_of_day))
        ? (input.time_of_day as TimeOfDay)
        : undefined;
      const wish: Preferences = {
        timeOfDay,
        after: timeOrUndefined(input.after),
        before: timeOrUndefined(input.before),
      };
      const found =
        input.when === "today"
          ? findOffers(state, appt, wish, true)
          : findOffers(
              state,
              appt,
              { ...wish, dayOffset: days.length === 1 ? days[0] : undefined },
              false,
              days.length > 1 ? days : undefined,
            );
      // Keep every slot offered in this turn (the AI may check more than once),
      // up to 5 — the most that can be labelled A–E. Offers are never a mix of
      // doctors: slots with another doctor offered earlier are dropped.
      if (offered.some((o) => o.doctorId)) offered.length = 0;
      for (const o of found.offers) {
        const seen = offered.some(
          (x) => x.dayOffset === o.dayOffset && x.startTime === o.startTime,
        );
        if (!seen && offered.length < OFFER_LETTERS.length) offered.push(o);
        times.add(o.startTime);
      }
      if (found.backAt) times.add(found.backAt);
      if (found.endsAt) times.add(found.endsAt);
      return {
        situation: found.situation,
        explanation: explainForAi(found),
        slots: toAiSlots(offered),
      };
    },
    book_slot(input) {
      if (outcome) return alreadyDone;
      const slot = { dayOffset: Number(input.day_offset), startTime: String(input.start_time) };
      if (!Number.isInteger(slot.dayOffset) || !isValidTime(slot.startTime)) {
        return { ok: false, reason: "Invalid slot." };
      }
      const result = onCopy((copyState, copyAppt) => bookSlotIn(copyState, copyAppt, slot, at));
      if (!result.ok) {
        const hint = "Call check_free_slots again and only offer what it returns.";
        // The doctor's return time is now later than this slot: the patient
        // gets DocDelay's fixed line with the real reason.
        const away = refusedBecauseAway(state, appt.doctorId, slot);
        if (away) {
          times.add(away.backAt);
          refusalLine = refusedPrefix(state, language, appt.doctorId, slot);
          return {
            ok: false,
            reason: `The doctor is now back at ${formatTime(away.backAt)}, so that time is no longer available.`,
            docdelay_says_first: refusalLine,
            hint: `DocDelay tells the patient that line itself: do not repeat it. ${hint}`,
          };
        }
        return { ...result, hint };
      }
      outcome = { kind: "book", ...slot };
      times.add(slot.startTime);
      return { ok: true, booked: say(slot), today: slot.dayOffset === 0 };
    },
    wait_later_today() {
      if (outcome) return alreadyDone;
      const result = onCopy((copyState, copyAppt) => {
        const noRoom = rescheduleLaterToday(copyState, copyAppt, at);
        return noRoom ? { noRoom } : { newTime: copyAppt.startTime };
      });
      if ("noRoom" in result) {
        return {
          ok: false,
          reason: `No room today: ${result.noRoom}.`,
          hint: "Say there is no room today, then offer other days with check_free_slots (when: other_days).",
        };
      }
      outcome = { kind: "wait" };
      times.add(result.newTime);
      return { ok: true, new_time: say({ dayOffset: 0, startTime: result.newTime }) };
    },
    cancel_appointment() {
      if (outcome) return alreadyDone;
      outcome = { kind: "cancel" };
      return { ok: true };
    },
    hand_to_staff(input) {
      if (outcome) return alreadyDone;
      // "Couldn't understand" is decided by the count below, never by the AI.
      const reason =
        input.reason === "no_suitable_time" ? "no_suitable_time" : ("asked_for_person" as const);
      outcome = { kind: "staff", reason };
      return { ok: true, tell_patient: staffWillCallReply(language) };
    },
    // Two replies in a row that couldn't be understood → staff call. The COUNT
    // is kept here in the hms module (shared with the rule-based chat), not by
    // the AI: the AI only says "I didn't understand this one".
    cannot_understand() {
      if (outcome) return alreadyDone;
      if ((appt.unclearInARow ?? 0) + 1 >= 2) {
        outcome = { kind: "staff", reason: "could_not_understand" };
        return { ok: true, handed_to_staff: true };
      }
      unclear = true; // DocDelay asks the patient to say it again (fixed wording)
      return { ok: true };
    },
    escalate_urgent() {
      // Allowed even after another outcome would have been — safety first.
      outcome = { kind: "urgent" };
      return { ok: true, say_exactly: urgentReply(language) };
    },
    // Another doctor of the same specialty today: ONLY approved doctors'
    // EMPTY slots (anotherDoctorSlotsIn — the same rules as Buttons mode).
    check_another_doctor_slots() {
      const slots = anotherDoctorSlotsIn(state, appt);
      // Offers are never a mix of doctors: this replaces anything offered before.
      offered.length = 0;
      offered.push(...slots);
      for (const o of slots) times.add(o.startTime);
      return slots.length
        ? {
            situation: "free",
            explanation:
              "Offer these as A, B, C. Say that another doctor from the same department can see them today, " +
              "and copy each slot's say text exactly (it includes the doctor's name).",
            slots: toAiSlots(offered),
          }
        : {
            situation: "none",
            explanation:
              "No other doctor from the same department is free today. Say so, then ask whether they " +
              "would like to wait for a later time today, move to another day, or cancel.",
            slots: [],
          };
    },
    book_with_another_doctor(input) {
      if (outcome) return alreadyDone;
      const startTime = String(input.start_time);
      // Only a slot that is STILL one of the allowed ones (approved doctor, same
      // specialty, empty, today, at or after the original time, ending by 5 PM)
      // — whether it was offered in this message or an earlier one. Then
      // re-checked by the hms rules when it's booked.
      const offer = anotherDoctorSlotsIn(state, appt).find((o) => o.startTime === startTime);
      if (!offer) {
        // A slot that WAS offered, but that doctor is now away at that time:
        // the patient gets DocDelay's fixed line with the real reason.
        const earlier = [...(appt.offers ?? []), ...offered].find(
          (o) => o.doctorId && o.dayOffset === 0 && o.startTime === startTime,
        );
        const away = earlier && refusedBecauseAway(state, earlier.doctorId!, earlier);
        if (earlier && away) {
          times.add(away.backAt);
          refusalLine = refusedPrefix(state, language, earlier.doctorId!, earlier);
          return {
            ok: false,
            reason: `That doctor is now back at ${formatTime(away.backAt)}, so that time is no longer available.`,
            docdelay_says_first: refusalLine,
            hint:
              "DocDelay tells the patient that line itself: do not repeat it. " +
              "Call check_another_doctor_slots again and offer the new options.",
          };
        }
        return {
          ok: false,
          reason: "That isn't one of the slots with another doctor.",
          hint: "Call check_another_doctor_slots and only offer what it returns.",
        };
      }
      const ok = onCopy((copyState, copyAppt) => bookWithAnotherDoctor(copyState, copyAppt, offer, at));
      if (!ok) {
        return {
          ok: false,
          reason: "That time was just taken.",
          hint: "Call check_another_doctor_slots again and offer the new options.",
        };
      }
      outcome = { kind: "book", dayOffset: 0, startTime, doctorId: offer.doctorId };
      times.add(startTime);
      return { ok: true, booked: say(offer) };
    },
  };

  return {
    context: {
      firstName: patient.name.split(" ")[0],
      language,
      reason: unavailability.reason,
      originalTimeSay: formatTimeFor(originalTimeOf(appt), language),
      doctorNameSay: doctorNameFor(doctor, language),
      doctorBackSay: formatTimeFor(bookingsStartAt(unavailability), language),
      calendar: Array.from({ length: DAYS_TO_SEARCH + 1 }, (_, d) => ({
        day_offset: d,
        date: d === 0 ? `today (${formatDate(0)})` : formatDate(d),
        closed: isClosedDay(d),
      })),
      currentOffers: toAiSlots(appt.offers ?? []),
      history: (appt.chat ?? []).slice(1).map((t) => ({ from: t.from, text: t.text })),
    },
    runTool: (name, input) => tools[name](input),
    allowedTimes: () => times,
    outcome: () => outcome,
    notUnderstood: () => unclear,
    refusalLine: () => refusalLine,
    // For a turn with an outcome, the reply is DocDelay's fixed confirmation
    // (added when the step is applied), so `reply` is ignored and not stored.
    async save(text, reply) {
      const step: DemoStep = {
        kind: "ai",
        at,
        appointmentId,
        text,
        reply: outcome || unclear ? "" : reply,
        offers: outcome ? [] : offered,
        action: outcome,
        unclear: !outcome && unclear,
      };
      if (!applyAi(replay(steps), step)) return false; // must apply cleanly
      return writeSteps([...steps, step]);
    },
  };
}

// Apply a saved AI turn (also when the demo is rebuilt). Same rules as
// everywhere else; returns false if it doesn't apply.
function applyAi(state: HmsState, step: Extract<DemoStep, { kind: "ai" }>): boolean {
  const appt = state.appointments.find((a) => a.id === step.appointmentId);
  if (!appt || appt.status !== "Affected – needs contact") return false;
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return false;
  const language = patients.find((p) => p.id === appt.patientId)!.preferredLanguage;
  const when = new Date(step.at).toISOString();
  const action = step.action;
  const log = (result: CallResult | undefined, detail: string) =>
    (appt.callLog = [
      ...(appt.callLog ?? []),
      { calledAt: when, result, detail: `AI chat: ${detail}` },
    ]);
  const dropOffers = () => {
    delete appt.offers;
    delete appt.offersBecause;
  };

  if (!appt.chat?.length)
    appt.chat = [{ at: when, from: "docdelay", text: openingLine(state, appt, unavailability) }];
  const understood = !action
    ? step.offers.length
      ? `AI · offered ${step.offers.map((o) => formatWhen(o.dayOffset, o.startTime)).join(" / ")}`
      : "AI · replied"
    : action.kind === "book"
      ? `AI · booked ${formatWhen(action.dayOffset, action.startTime)}${
          action.doctorId ? ` with ${doctors.find((d) => d.id === action.doctorId)?.name}` : ""
        }`
      : action.kind === "staff"
        ? `AI · staff call (${action.reason.replace(/_/g, " ")})`
        : `AI · ${{ wait: "waits for later today", cancel: "cancelled", urgent: "URGENT (health concern)" }[action.kind]}`;
  appt.chat.push({
    at: when,
    from: "patient",
    text: step.text,
    understood: step.unclear ? "AI · couldn't understand (1 of 2)" : understood,
  });
  // Count unclear replies in a row (shared with the rule-based chat).
  appt.unclearInARow = step.unclear ? (appt.unclearInARow ?? 0) + 1 : 0;
  delete appt.timeWish;

  if (!action) {
    if (step.offers.length) {
      appt.offers = step.offers;
      appt.offersBecause = step.offers.some((o) => o.doctorId) ? "another doctor" : "asked";
    }
  } else if (action.kind === "book" && action.doctorId) {
    // Another doctor today — re-checked with the same rules as Buttons mode.
    const offer = { dayOffset: 0, startTime: action.startTime, doctorId: action.doctorId };
    if (action.dayOffset !== 0 || !bookWithAnotherDoctor(state, appt, offer, step.at)) return false;
    log("Wants another doctor today", `booked ${formatTime(action.startTime)} with another doctor`);
  } else if (action.kind === "book") {
    const slot = { dayOffset: action.dayOffset, startTime: action.startTime };
    if (!bookSlotIn(state, appt, slot, step.at).ok) return false;
    log(
      slot.dayOffset === 0 ? "Wants later today" : "Wants another day",
      `booked ${formatWhen(slot.dayOffset, slot.startTime)}`,
    );
  } else if (action.kind === "wait") {
    if (rescheduleLaterToday(state, appt, step.at)) return false;
    dropOffers();
    log("Wants later today", `new time ${formatTime(appt.startTime)} today`);
  } else if (action.kind === "cancel") {
    appt.status = "Cancelled";
    dropOffers();
    log("Cancelled", "cancelled");
  } else if (action.kind === "staff") {
    appt.status = "Needs staff call";
    appt.note = STAFF_NOTES[action.reason];
    dropOffers();
    log("Needs staff call", appt.note);
  } else {
    // SAFETY: the same as the rule-based check — nothing booked or reserved.
    appt.status = "URGENT – staff call now";
    dropOffers();
    log(undefined, "health concern → URGENT staff call");
  }
  // Outcomes are confirmed with DocDelay's FIXED wording (the same lines as
  // the rule-based chat — always with AM/PM and the local time words), never
  // with AI-written text. The urgent reply is always the fixed safety line.
  // "Couldn't understand" is also answered with DocDelay's fixed line.
  const confirmation = !action
    ? step.unclear
      ? unclearReply(language, Boolean(appt.offers))
      : step.reply
    : action.kind === "urgent"
      ? urgentReply(language)
      : action.kind === "cancel"
        ? cancelledReply(language)
        : action.kind === "staff"
          ? staffWillCallReply(language)
          : action.kind === "book" && action.doctorId
            ? anotherDoctorReply(
                language,
                appt.startTime,
                doctorNameFor(doctors.find((d) => d.id === appt.doctorId)!, language),
              )
            : appt.dayOffset === 0
            ? laterTodayReply(language, appt.startTime)
            : anotherDayReply(language, appt.dayOffset, appt.startTime);
  appt.chat.push({ at: when, from: "docdelay", text: confirmation });
  return true;
}

// ---------- URGENT flags ----------

// A staff member says an URGENT flag was a false alarm: the patient goes back
// to "Affected – needs contact" (and back into the normal call queue — no
// advantage, no penalty). It's logged with who and when.
export async function markFalseAlarm(appointmentId: string): Promise<boolean> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "falseAlarm", at: realTimestamp(), appointmentId };
  if (!applyFalseAlarm(replay(steps), step)) return false;
  return writeSteps([...steps, step]);
}

// The demo has no staff logins, so every false alarm is marked by "Front desk".
const STAFF_NAME = "Front desk";

function applyFalseAlarm(
  state: HmsState,
  step: Extract<DemoStep, { kind: "falseAlarm" }>,
): boolean {
  const appt = state.appointments.find((a) => a.id === step.appointmentId);
  if (!appt || appt.status !== "URGENT – staff call now") return false;
  const when = new Date(step.at).toISOString();
  // A patient who had already answered (URGENT came from a later WhatsApp
  // message) goes back to the status they had, with their booking as it was.
  const back = appt.statusBeforeUrgent ?? "Affected – needs contact";
  appt.status = back;
  delete appt.statusBeforeUrgent;
  appt.unclearInARow = 0;
  appt.falseAlarms = [...(appt.falseAlarms ?? []), { at: when, by: STAFF_NAME }];
  appt.callLog = [
    ...(appt.callLog ?? []),
    {
      calledAt: when,
      detail: `Marked as a false alarm by ${STAFF_NAME} — back to "${back}"`,
    },
  ];
  return true;
}

// Everyone who needs a staff call: URGENT first, then "Needs staff call",
// each group earliest first.
export async function getStaffCallList(): Promise<
  (AppointmentWithPatient & { doctorName: string })[]
> {
  const state = await loadState();
  const rank = (a: Appointment) => (a.status === "URGENT – staff call now" ? 0 : 1);
  return state.appointments
    .filter((a) => a.status === "URGENT – staff call now" || a.status === "Needs staff call")
    .sort((a, b) => rank(a) - rank(b) || byDayAndTime(a, b))
    .map((a) => ({
      ...withPatient(a),
      doctorName: doctors.find((d) => d.id === a.doctorId)!.name,
    }));
}

// Put this visitor's demo back to the starting data.
export async function resetDemo(): Promise<void> {
  await clearSteps();
}
