// The text message a patient gets when their appointment time changes.
//
// ⚠️ IMPORTANT: The Tamil and Hindi wording below was written for this demo
// and has NOT been checked by a native speaker. A native Tamil speaker and a
// native Hindi speaker must review it before any real patient receives it.

import type { Language, UnavailabilityReason } from "@/hms/types";

export interface SmsDetails {
  language: Language;
  hospitalName: string;
  doctorName: string;
  reason: UnavailabilityReason; // why the doctor was unavailable
  newTime: string; // already formatted, e.g. "2:45 PM"
}

export function timeChangedSms(d: SmsDetails): string {
  // "Other" isn't necessarily an emergency, so it gets gentler wording.
  const isEmergency = d.reason !== "Other";

  switch (d.language) {
    case "English":
      return (
        `${d.hospitalName}: your appointment with ${d.doctorName} is now at ${d.newTime} today ` +
        `${isEmergency ? "due to an emergency" : "due to a schedule change"}. ` +
        `Reply 1 to confirm, 2 to change.`
      );

    case "Tamil":
      // Needs native-speaker review (see note at the top).
      return (
        `${d.hospitalName}: ${d.doctorName} உடனான உங்கள் சந்திப்பு ` +
        `${isEmergency ? "அவசர நிலை காரணமாக" : "அட்டவணை மாற்றம் காரணமாக"} ` +
        `இன்று ${d.newTime} மணிக்கு மாற்றப்பட்டுள்ளது. ` +
        `உறுதிப்படுத்த 1, மாற்ற 2 என பதிலளிக்கவும்.`
      );

    case "Hindi":
      // Needs native-speaker review (see note at the top).
      return (
        `${d.hospitalName}: ${d.doctorName} के साथ आपकी अपॉइंटमेंट ` +
        `${isEmergency ? "एक इमरजेंसी के कारण" : "समय-सारणी में बदलाव के कारण"} ` +
        `अब आज ${d.newTime} पर है। ` +
        `पुष्टि के लिए 1, बदलने के लिए 2 भेजें।`
      );
  }
}
