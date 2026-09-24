// The FAKE hospital system (HMS).
//
// This is the ONLY file that reads hospital data. The rest of the app
// calls the functions below and never touches mockData.json directly.
// To connect a real HMS later, write a new file with the same functions
// (same names, same return types) and switch the imports over to it.
//
// The functions are "async" even though the fake data is instant,
// because a real HMS will be reached over the network.

import data from "./mockData.json";
import type {
  Appointment,
  AppointmentWithPatient,
  Doctor,
  Hospital,
  Patient,
} from "./types";

// Tell TypeScript the JSON file matches our shared types.
const hospital = data.hospital as Hospital;
const doctors = data.doctors as Doctor[];
const patients = data.patients as Patient[];
const appointments = data.appointments as Appointment[];

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
export async function getTodaysAppointments(
  doctorId: string,
): Promise<AppointmentWithPatient[]> {
  return appointments
    .filter((a) => a.doctorId === doctorId)
    .sort((a, b) => a.startTime.localeCompare(b.startTime)) // "09:15" < "10:00" works as text
    .map((a) => ({
      ...a,
      patient: patients.find((p) => p.id === a.patientId)!,
    }));
}
