// How a doctor's name is shown to a PATIENT, in their language:
//   English: "Dr. Meera Krishnan"
//   Tamil:   "டாக்டர் மீரா கிருஷ்ணன் (Dr. Meera Krishnan)"
//   Hindi:   "डॉ. मीरा कृष्णन (Dr. Meera Krishnan)"
// The local-script names come from the hospital data (Doctor.localNames); if
// there isn't one, the English name is used on its own.
//
// ⚠️ The Tamil and Hindi spellings of the doctors' names (in mockData.json)
// must be checked by a native speaker — and ideally by the doctors themselves.

import type { Doctor, Language } from "@/hms/types";

export function doctorNameFor(doctor: Doctor, language: Language): string {
  if (language === "English") return doctor.name;
  const local = doctor.localNames?.[language];
  return local ? `${local} (${doctor.name})` : doctor.name;
}
