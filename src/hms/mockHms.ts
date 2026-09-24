// The FAKE hospital system (HMS).
//
// This is the ONLY file that reads or changes hospital data. The rest of the
// app calls the functions below and never touches the data files directly.
// To connect a real HMS later, write a new file with the same functions
// (same names, same return types) and switch the imports over to it.
//
// Where the data lives:
//   - mockData.json      = the untouched starting data (never changed by the app)
//   - data/hms-state.json = today's CURRENT state (statuses, times,
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
import { planLaterToday, SLOT_MINUTES } from "@/lib/reschedulingRules";
import { timeChangedSms } from "@/lib/smsText";
import { formatTime, fromMinutes, toMinutes } from "@/lib/time";

// Hospital, doctors and patients never change, so we read them straight
// from the starting data. (Tell TypeScript the JSON matches our types.)
const hospital = startingData.hospital as Hospital;
const doctors = startingData.doctors as Doctor[];
const patients = startingData.patients as Patient[];

// ---------- Saving and loading the current state ----------

// Everything that CAN change during the day.
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
  // Empty lists first, so a state file saved by an older version still works.
  return {
    pendingUpdates: [],
    messages: [],
    ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")),
  };
}

function saveState(state: HmsState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

// Does this appointment START inside the doctor's unavailable window?
// (from ≤ start < until — someone booked exactly at "until" is fine.)
function isInWindow(
  appt: Appointment,
  window: Pick<Unavailability, "doctorId" | "fromTime" | "untilTime">,
): boolean {
  return (
    appt.doctorId === window.doctorId &&
    appt.startTime >= window.fromTime &&
    appt.startTime < window.untilTime
  );
}

function withPatient(appt: Appointment): AppointmentWithPatient {
  return { ...appt, patient: patients.find((p) => p.id === appt.patientId)! };
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

// Today's appointments for one doctor, earliest first, with patient details.
export async function getTodaysAppointments(doctorId: string): Promise<AppointmentWithPatient[]> {
  return loadState()
    .appointments.filter((a) => a.doctorId === doctorId)
    .sort((a, b) => a.startTime.localeCompare(b.startTime)) // "09:15" < "10:00" works as text
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
// their status or time is now), earliest first, with patient details.
export async function getAffectedAppointments(
  unavailabilityId: string,
): Promise<AppointmentWithPatient[]> {
  return loadState()
    .appointments.filter((a) => a.unavailabilityId === unavailabilityId)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
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
// call log and change its status. "Later today" also finds a new time
// straight away (see rescheduleLaterToday below).
// Only patients still waiting for a call can be recorded — this stops a
// double-click from logging the same call twice. Returns false if skipped.
export async function recordCallResult(
  appointmentId: string,
  result: CallResult,
): Promise<boolean> {
  const state = loadState();
  const appt = state.appointments.find((a) => a.id === appointmentId);
  if (!appt || appt.status !== "Affected – needs contact") return false;

  appt.callLog = [...(appt.callLog ?? []), { calledAt: new Date().toISOString(), result }];

  if (result === "Wants later today") {
    rescheduleLaterToday(state, appt);
  } else {
    appt.status = result;
  }

  saveState(state);
  return true;
}

// Give a patient who pressed "1 – Later today" a new time, following the
// rules in lib/reschedulingRules.ts. Changes `state`; the caller saves it.
function rescheduleLaterToday(state: HmsState, appt: Appointment): void {
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  const doctorsAppointments = state.appointments.filter((a) => a.doctorId === appt.doctorId);
  const plan = unavailability
    ? planLaterToday(appt, doctorsAppointments, unavailability.untilTime)
    : ({ kind: "no room" } as const); // shouldn't happen, but be safe

  if (plan.kind === "no room") {
    appt.status = "Needs staff call";
    appt.note = "No room today";
    return;
  }

  // The patient first, then (if there was a push) everyone who moves back.
  moveAppointment(
    state,
    appt,
    plan.newStartTime,
    "Patient chose a later time today",
    unavailability!,
  );
  appt.status = "Rescheduled – later today";

  if (plan.kind === "push") {
    for (const p of plan.pushed) {
      const other = state.appointments.find((a) => a.id === p.appointmentId)!;
      moveAppointment(
        state,
        other,
        p.newStartTime,
        "Pushed back 15 minutes to make room for a rescheduled patient",
        unavailability!,
      );
      // Only plain bookings become "Time moved". Someone already
      // "Rescheduled – later today" keeps that status (their new time still shows).
      if (other.status === "Scheduled") other.status = "Time moved";
    }
  }
}

// Change an appointment's time: note it in its history and keep ONE pending
// update for the patient with their latest time (nothing is sent yet — see
// sendPendingUpdates). Changes `state`; the caller saves it.
function moveAppointment(
  state: HmsState,
  appt: Appointment,
  newStartTime: string,
  why: string,
  unavailability: Unavailability,
): void {
  const now = new Date().toISOString();
  appt.timeHistory = [
    ...(appt.timeHistory ?? []),
    { changedAt: now, oldStartTime: appt.startTime, newStartTime, why },
  ];
  appt.startTime = newStartTime;
  appt.endTime = fromMinutes(toMinutes(newStartTime) + SLOT_MINUTES);

  // Replace this patient's pending update (if any) with the latest time.
  state.pendingUpdates = state.pendingUpdates.filter((u) => u.appointmentId !== appt.id);
  state.pendingUpdates.push({
    appointmentId: appt.id,
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
