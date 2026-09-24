// Shared data shapes for talking to a hospital system (HMS).
// Both the mock HMS and any future real HMS (FHIR or custom API)
// must return data in these shapes, so the rest of the app never changes.

export type Language = "English" | "Tamil" | "Hindi";

// For now every appointment is "Scheduled". More statuses come later.
export type AppointmentStatus = "Scheduled";

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
}

// An appointment with its patient's details attached — handy for screens.
export interface AppointmentWithPatient extends Appointment {
  patient: Patient;
}
