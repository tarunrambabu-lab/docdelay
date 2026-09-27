// The text message a patient gets when their appointment time changes.
//
// ⚠️ IMPORTANT: The Tamil and Hindi wording below was written for this demo
// and has NOT been checked by a native speaker. A native Tamil speaker and a
// native Hindi speaker must review it before any real patient receives it.

import type { Language, UnavailabilityReason } from "@/hms/types";
import { formatDate, formatTimeFor } from "@/lib/time";

export interface SmsDetails {
  language: Language;
  hospitalName: string;
  doctorName: string;
  reason: UnavailabilityReason; // why the doctor was unavailable
  newDayOffset: number; // 0 = today
  newStartTime: string; // "HH:MM" — always written with AM/PM (see formatTimeFor)
}

export function timeChangedSms(d: SmsDetails): string {
  // "Other" isn't necessarily an emergency, so it gets gentler wording.
  const isEmergency = d.reason !== "Other";
  const today = d.newDayOffset === 0;
  const date = formatDate(d.newDayOffset, d.language);
  // Always with AM/PM; Tamil/Hindi also get the local time-of-day word,
  // e.g. "மாலை 4:30 (4:30 PM)". (Native-speaker check needed — see formatTimeFor.)
  const newTime = formatTimeFor(d.newStartTime, d.language);

  switch (d.language) {
    case "English":
      return (
        `${d.hospitalName}: your appointment with ${d.doctorName} is now ` +
        (today ? `at ${newTime} today ` : `on ${date} at ${newTime} `) +
        `${isEmergency ? "due to an emergency" : "due to a schedule change"}. ` +
        `Reply 1 to confirm, 2 to change.`
      );

    case "Tamil":
      // Needs native-speaker review (see note at the top).
      return (
        `${d.hospitalName}: ${d.doctorName} உடனான உங்கள் சந்திப்பு ` +
        `${isEmergency ? "அவசர நிலை காரணமாக" : "அட்டவணை மாற்றம் காரணமாக"} ` +
        (today ? `இன்று ${newTime} மணிக்கு` : `${date} அன்று ${newTime} மணிக்கு`) +
        ` மாற்றப்பட்டுள்ளது. உறுதிப்படுத்த 1, மாற்ற 2 என பதிலளிக்கவும்.`
      );

    case "Hindi":
      // Needs native-speaker review (see note at the top).
      return (
        `${d.hospitalName}: ${d.doctorName} के साथ आपकी अपॉइंटमेंट ` +
        `${isEmergency ? "एक इमरजेंसी के कारण" : "समय-सारणी में बदलाव के कारण"} ` +
        (today ? `अब आज ${newTime} पर है।` : `अब ${date} को ${newTime} पर है।`) +
        ` पुष्टि के लिए 1, बदलने के लिए 2 भेजें।`
      );
  }
}
