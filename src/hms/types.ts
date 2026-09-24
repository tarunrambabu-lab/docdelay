// Shared data shapes for talking to a hospital system (HMS).
// Both the mock HMS and any future real HMS (FHIR or custom API)
// must return data in these shapes, so the rest of the app never changes.

export type Language = "English" | "Tamil" | "Hindi";

// What a patient answered on a (simulated) call. Each one is also a status.
export const CALL_RESULTS = [
  "Wants later today",
  "Wants another day",
  "Cancelled",
  "Needs staff call",
  "No answer",
] as const;
export type CallResult = (typeof CALL_RESULTS)[number];

export type AppointmentStatus = "Scheduled" | "Affected – needs contact" | CallResult;

// One line in an appointment's call log.
export interface CallLogEntry {
  calledAt: string; // when the call happened (ISO date-time)
  result: CallResult;
}

export const UNAVAILABILITY_REASONS = ["Emergency surgery", "Personal emergency", "Other"] as const;
export type UnavailabilityReason = (typeof UNAVAILABILITY_REASONS)[number];

// A stretch of time today when a doctor can't see patients.
export interface Unavailability {
  id: string;
  doctorId: string;
  reason: UnavailabilityReason;
  fromTime: string; // "HH:MM"
  untilTime: string; // "HH:MM"
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
  callLog?: CallLogEntry[]; // only there once the patient has been called
}

// An appointment with its patient's details attached — handy for screens.
export interface AppointmentWithPatient extends Appointment {
  patient: Patient;
}
