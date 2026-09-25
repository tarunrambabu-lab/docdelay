// The FAKE hospital system (HMS).
//
// This is the ONLY file that reads or changes hospital data. The rest of the
// app calls the functions below and never touches the data files directly.
// To connect a real HMS later, write a new file with the same functions
// (same names, same return types) and switch the imports over to it.
//
// Where the data lives:
//   - mockData.json      = the untouched starting data (never changed by the app).
//     It holds today and the next 7 days; each appointment has a "dayOffset"
//     (0 = today, 1 = tomorrow, …), so the demo always starts "today".
//   - data/hms-state.json = the CURRENT state (statuses, times,
//     unavailabilities, pending updates, simulated text messages).
//     It's created from mockData.json the first time it's needed, and
//     "Reset demo" deletes it so we start fresh.
//
// The functions are "async" even though the fake data is instant,
// because a real HMS will be reached over the network.

import fs from "node:fs";
import path from "node:path";
import startingData from "./mockData.json";
import type {
  Appointment,
  AppointmentWithPatient,
  CallLogEntry,
  CallResult,
  Doctor,
  Hospital,
  Patient,
  PendingUpdate,
  PendingUpdateWithDetails,
  SmsMessage,
  Unavailability,
  UnavailabilityReason,
} from "./types";
import {
  findOtherDaySlots,
  isClosedDay,
  isSlotFree,
  planLaterToday,
  SLOT_MINUTES,
} from "@/lib/reschedulingRules";
import { OFFER_LETTERS } from "@/lib/callScript";
import { timeChangedSms } from "@/lib/smsText";
import { formatTime, formatWhen, fromMinutes, toMinutes } from "@/lib/time";

// Hospital, doctors and patients never change, so we read them straight
// from the starting data. (Tell TypeScript the JSON matches our types.)
const hospital = startingData.hospital as Hospital;
const doctors = startingData.doctors as Doctor[];
const patients = startingData.patients as Patient[];

// ---------- Saving and loading the current state ----------

// Everything that CAN change.
interface HmsState {
  appointments: Appointment[];
  unavailabilities: Unavailability[];
  pendingUpdates: PendingUpdate[]; // texts waiting to be sent (one per appointment)
  messages: SmsMessage[]; // simulated text messages that were "sent" ("SMS outbox")
}

const STATE_FILE = path.join(process.cwd(), "data", "hms-state.json");

function startingState(): HmsState {
  return {
    // structuredClone makes a full copy, so the starting data stays untouched.
    appointments: structuredClone(startingData.appointments) as Appointment[],
    unavailabilities: [],
    pendingUpdates: [],
    messages: [],
  };
}

function loadState(): HmsState {
  if (!fs.existsSync(STATE_FILE)) return startingState();
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  // A state file saved before appointments had days can't be used: start fresh.
  if (saved.appointments.some((a: Appointment) => a.dayOffset === undefined)) {
    return startingState();
  }
  // Empty lists first, so a state file saved by an older version still works.
  return { pendingUpdates: [], messages: [], ...saved };
}

function saveState(state: HmsState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
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
  return loadState()
    .appointments.filter((a) => a.doctorId === doctorId && a.dayOffset === dayOffset)
    .sort(byDayAndTime)
    .map(withPatient);
}

// Appointments that were first booked on this day but have since moved to
// another day (so the front desk can still see where they went).
export async function getAppointmentsMovedAwayFrom(
  doctorId: string,
  dayOffset: number,
): Promise<AppointmentWithPatient[]> {
  return loadState()
    .appointments.filter(
      (a) =>
        a.doctorId === doctorId &&
        a.dayOffset !== dayOffset &&
        a.timeHistory?.[0]?.oldDayOffset === dayOffset,
    )
    .map(withPatient);
}

// Every doctor unavailability recorded today, in the order they were added.
export async function getUnavailabilities(): Promise<Unavailability[]> {
  return loadState().unavailabilities;
}

export async function getUnavailability(id: string): Promise<Unavailability | undefined> {
  return loadState().unavailabilities.find((u) => u.id === id);
}

// All appointments affected by one "doctor unavailable" event (whatever
// their status, day or time is now), earliest first, with patient details.
export async function getAffectedAppointments(
  unavailabilityId: string,
): Promise<AppointmentWithPatient[]> {
  return loadState()
    .appointments.filter((a) => a.unavailabilityId === unavailabilityId)
    .sort(byDayAndTime)
    .map(withPatient);
}

export async function getAppointment(id: string): Promise<AppointmentWithPatient | undefined> {
  const appt = loadState().appointments.find((a) => a.id === id);
  return appt && withPatient(appt);
}

// Texts waiting to be sent, oldest change first, with appointment details.
export async function getPendingUpdates(): Promise<PendingUpdateWithDetails[]> {
  const state = loadState();
  return state.pendingUpdates.map((u) => ({
    ...u,
    appointment: withPatient(state.appointments.find((a) => a.id === u.appointmentId)!),
  }));
}

// All simulated text messages that were "sent", newest first.
export async function getMessages(): Promise<SmsMessage[]> {
  return [...loadState().messages].reverse();
}

// ---------- Changing ----------

// Record that a doctor is unavailable between two times today.
// Every appointment that starts inside the window becomes
// "Affected – needs contact" and remembers which event affected it.
export async function markDoctorUnavailable(input: {
  doctorId: string;
  reason: UnavailabilityReason;
  fromTime: string;
  untilTime: string;
}): Promise<Unavailability> {
  const state = loadState();
  const id = `unavail-${Date.now()}`;

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

  saveState(state);
  return unavailability;
}

// Save what a patient answered on a call: add a line to the appointment's
// call log and change its status.
//   - "Later today" finds a new time today straight away; if there's no room,
//     the patient is offered other days instead.
//   - "Another day" offers other days.
// Only patients still waiting for a call (and not already looking at offers)
// can be recorded — this stops a double-click from logging the same call twice.
// Returns false if skipped.
export async function recordCallResult(
  appointmentId: string,
  result: CallResult,
): Promise<boolean> {
  const state = loadState();
  const appt = state.appointments.find((a) => a.id === appointmentId);
  if (!appt || appt.status !== "Affected – needs contact" || appt.offers) return false;

  const logEntry: CallLogEntry = { calledAt: new Date().toISOString(), result };
  appt.callLog = [...(appt.callLog ?? []), logEntry];

  if (result === "Wants later today") {
    const noRoomBecause = rescheduleLaterToday(state, appt);
    if (noRoomBecause) {
      logEntry.detail = `No room today: ${noRoomBecause}`;
      offerOtherDays(state, appt, "no room today");
    }
  } else if (result === "Wants another day") {
    offerOtherDays(state, appt, "asked");
  } else {
    appt.status = result;
  }

  saveState(state);
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
  const state = loadState();
  const appt = state.appointments.find((a) => a.id === appointmentId);
  if (!appt?.offers || appt.status !== "Affected – needs contact") return "skipped";

  const log = (detail: string) =>
    (appt.callLog = [
      ...(appt.callLog ?? []),
      { calledAt: new Date().toISOString(), result: "Wants another day", detail },
    ]);

  if (choice === null) {
    appt.status = "Needs staff call";
    appt.note = "Wants a different day";
    delete appt.offers;
    delete appt.offersBecause;
    log("None of these – call me");
    saveState(state);
    return "none";
  }

  const offer = appt.offers[choice];
  if (!offer) return "skipped";

  // Make sure nobody took the slot in the meantime.
  const thatDay = state.appointments.filter(
    (a) => a.doctorId === appt.doctorId && a.dayOffset === offer.dayOffset,
  );
  if (!isSlotFree(thatDay, toMinutes(offer.startTime))) {
    offerOtherDays(state, appt, appt.offersBecause ?? "asked");
    saveState(state);
    return "taken";
  }

  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId)!;
  moveAppointment(
    state,
    appt,
    offer.dayOffset,
    offer.startTime,
    "Patient chose another day",
    unavailability,
  );
  appt.status = "Rescheduled – another day";
  delete appt.offers;
  delete appt.offersBecause;
  log(`Picked ${OFFER_LETTERS[choice]}: ${formatWhen(offer.dayOffset, offer.startTime)}`);
  saveState(state);
  return "booked";
}

// Give a patient who pressed "1 – Later today" a new time today, following the
// rules in lib/reschedulingRules.ts. Changes `state`; the caller saves it.
// Returns null if it worked, or the reason there was no room today.
function rescheduleLaterToday(state: HmsState, appt: Appointment): string | null {
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return "unknown unavailability"; // shouldn't happen
  const todaysAppointments = state.appointments.filter(
    (a) => a.doctorId === appt.doctorId && a.dayOffset === 0,
  );
  const plan = planLaterToday(appt, todaysAppointments, unavailability.untilTime);

  if (plan.kind === "no room") return plan.why;

  // The patient first, then (if there was a push) everyone who moves back.
  moveAppointment(
    state,
    appt,
    0,
    plan.newStartTime,
    "Patient chose a later time today",
    unavailability,
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
      );
      // Only plain bookings become "Time moved". Someone already
      // "Rescheduled – later today" keeps that status (their new time still shows).
      if (other.status === "Scheduled") other.status = "Time moved";
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
): void {
  const now = new Date().toISOString();
  appt.timeHistory = [
    ...(appt.timeHistory ?? []),
    {
      changedAt: now,
      oldDayOffset: appt.dayOffset,
      oldStartTime: appt.startTime,
      newDayOffset,
      newStartTime,
      why,
    },
  ];
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

// "Send" every pending update: turn each into a text message in the outbox
// (in the patient's language) and clear the pending list. Nothing is really
// sent. If a patient is moved again later, they get a new pending update.
// Returns how many messages were "sent".
export async function sendPendingUpdates(): Promise<number> {
  const state = loadState();
  const now = new Date().toISOString();

  for (const update of state.pendingUpdates) {
    const appt = state.appointments.find((a) => a.id === update.appointmentId)!;
    const patient = patients.find((p) => p.id === appt.patientId)!;
    const doctor = doctors.find((d) => d.id === appt.doctorId)!;
    state.messages.push({
      id: `sms-${state.messages.length + 1}`,
      sentAt: now,
      appointmentId: appt.id,
      toName: patient.name,
      toPhone: patient.phone,
      language: patient.preferredLanguage,
      text: timeChangedSms({
        language: patient.preferredLanguage,
        hospitalName: hospital.name,
        doctorName: doctor.name,
        reason: update.reason,
        newDayOffset: update.newDayOffset,
        newTime: formatTime(update.newStartTime),
      }),
    });
  }

  const sent = state.pendingUpdates.length;
  state.pendingUpdates = [];
  saveState(state);
  return sent;
}

// Put everything back to the starting data.
export async function resetDemo(): Promise<void> {
  fs.rmSync(STATE_FILE, { force: true });
}
