// The FAKE hospital system (HMS).
//
// This is the ONLY file that reads or changes hospital data. The rest of the
// app calls the functions below and never touches the data files directly.
// To connect a real HMS later, write a new file with the same functions
// (same names, same return types) and switch the imports over to it.
//
// Where the data lives:
//   - mockData.json      = the untouched starting data (never changed by the app)
//   - data/hms-state.json = today's CURRENT state (statuses, unavailabilities).
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
  Unavailability,
  UnavailabilityReason,
} from "./types";

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
}

const STATE_FILE = path.join(process.cwd(), "data", "hms-state.json");

function startingState(): HmsState {
  return {
    // structuredClone makes a full copy, so the starting data stays untouched.
    appointments: structuredClone(startingData.appointments) as Appointment[],
    unavailabilities: [],
  };
}

function loadState(): HmsState {
  if (!fs.existsSync(STATE_FILE)) return startingState();
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
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

// All appointments inside one unavailable window (whatever their status now),
// earliest first, with patient details.
export async function getAppointmentsInWindow(
  unavailabilityId: string,
): Promise<AppointmentWithPatient[]> {
  const state = loadState();
  const window = state.unavailabilities.find((u) => u.id === unavailabilityId);
  if (!window) return [];
  return state.appointments
    .filter((a) => isInWindow(a, window))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map(withPatient);
}

// ---------- Changing ----------

// Record that a doctor is unavailable between two times today.
// Every appointment that starts inside the window becomes
// "Affected – needs contact".
export async function markDoctorUnavailable(input: {
  doctorId: string;
  reason: UnavailabilityReason;
  fromTime: string;
  untilTime: string;
}): Promise<Unavailability> {
  const state = loadState();

  let affectedCount = 0;
  for (const appt of state.appointments) {
    if (isInWindow(appt, input)) {
      appt.status = "Affected – needs contact";
      affectedCount++;
    }
  }

  const unavailability: Unavailability = {
    id: `unavail-${Date.now()}`,
    ...input,
    affectedCount,
  };
  state.unavailabilities.push(unavailability);

  saveState(state);
  return unavailability;
}

// Save what a patient answered on a call: add a line to the appointment's
// call log and change its status to the answer.
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
  appt.status = result;

  saveState(state);
  return true;
}

// Put everything back to the starting data.
export async function resetDemo(): Promise<void> {
  fs.rmSync(STATE_FILE, { force: true });
}
