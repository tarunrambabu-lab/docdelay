// Shared data shapes for talking to a hospital system (HMS).
// Both the mock HMS and any future real HMS (FHIR or custom API)
// must return data in these shapes, so the rest of the app never changes.

export type Language = "English" | "Tamil" | "Hindi";

// What a patient pressed on a (simulated) call.
export const CALL_RESULTS = [
  "Wants later today",
  "Wants another day",
  "Cancelled",
  "Needs staff call",
  "No answer",
] as const;
export type CallResult = (typeof CALL_RESULTS)[number];

export type AppointmentStatus =
  | "Scheduled"
  | "Affected – needs contact"
  | "Rescheduled – later today" // patient pressed 1 and got a new time
  | "Wants another day"
  | "Cancelled"
  | "Needs staff call"
  | "No answer"
  | "Time moved"; // pushed back to make room for a rescheduled patient

// One line in an appointment's call log.
export interface CallLogEntry {
  calledAt: string; // when the call happened (ISO date-time)
  result: CallResult;
}

// One line in an appointment's time-change history.
export interface TimeChange {
  changedAt: string; // ISO date-time
  oldStartTime: string; // "HH:MM"
  newStartTime: string; // "HH:MM"
  why: string;
}

export const UNAVAILABILITY_REASONS = ["Emergency surgery", "Personal emergency", "Other"] as const;
export type UnavailabilityReason = (typeof UNAVAILABILITY_REASONS)[number];

// A stretch of time today when a doctor can't see patients.
export interface Unavailability {
  id: string;
  doctorId: string;
  reason: UnavailabilityReason;
  fromTime: string; // "HH:MM"
  untilTime: string; // "HH:MM" — the doctor's expected return time
  affectedCount: number; // how many appointments fell inside the window
}

export interface Hospital {
  id: string;
  name: string;
  city: string;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
}

export interface Patient {
  id: string;
  name: string;
  phone: string;
  preferredLanguage: Language;
}

export interface Appointment {
  id: string;
  doctorId: string;
  patientId: string;
  startTime: string; // "HH:MM", 24-hour clock, always today
  endTime: string; // "HH:MM"
  reason: string;
  status: AppointmentStatus;
  unavailabilityId?: string; // which "doctor unavailable" event affected it
  note?: string; // e.g. "No room today"
  callLog?: CallLogEntry[]; // only there once the patient has been called
  timeHistory?: TimeChange[]; // only there once its time has changed
}

// An appointment with its patient's details attached — handy for screens.
export interface AppointmentWithPatient extends Appointment {
  patient: Patient;
}

// A text message waiting to be sent. There is at most ONE per appointment,
// and it always holds the latest new time — so a patient who is moved several
// times gets a single message with their final time.
export interface PendingUpdate {
  appointmentId: string;
  newStartTime: string; // "HH:MM" — the latest time
  reason: UnavailabilityReason; // why the doctor was unavailable (for the wording)
  updatedAt: string; // ISO date-time of the latest change
}

// A pending update with the appointment and patient details attached.
export interface PendingUpdateWithDetails extends PendingUpdate {
  appointment: AppointmentWithPatient;
}

// A simulated text message (nothing is really sent).
export interface SmsMessage {
  id: string;
  sentAt: string; // ISO date-time
  appointmentId: string;
  toName: string;
  toPhone: string;
  language: Language;
  text: string;
}
