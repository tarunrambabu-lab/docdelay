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
  doctorName: string; // the doctor the appointment is with NOW
  // Only if the patient moved to another doctor: who they were booked with
  // before. Then the text says "now with Dr. X (instead of Dr. Y)".
  previousDoctorName?: string;
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

  if (d.previousDoctorName) return anotherDoctorSms(d, isEmergency, today, date, newTime);

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

// The same text for a patient who moved to ANOTHER doctor: it names the new
// doctor and says who it replaces. (Tamil and Hindi need native-speaker review.)
function anotherDoctorSms(
  d: SmsDetails,
  isEmergency: boolean,
  today: boolean,
  date: string,
  newTime: string,
): string {
  switch (d.language) {
    case "English":
      return (
        `${d.hospitalName}: your appointment is now with ${d.doctorName} ` +
        `(instead of ${d.previousDoctorName}) ` +
        (today ? `at ${newTime} today ` : `on ${date} at ${newTime} `) +
        `${isEmergency ? "due to an emergency" : "due to a schedule change"}. ` +
        `Reply 1 to confirm, 2 to change.`
      );

    case "Tamil":
      return (
        `${d.hospitalName}: ` +
        `${isEmergency ? "அவசர நிலை காரணமாக" : "அட்டவணை மாற்றம் காரணமாக"}, ` +
        `உங்கள் சந்திப்பு இப்போது ${d.previousDoctorName} அவர்களுக்குப் பதிலாக ${d.doctorName} உடன் ` +
        (today ? `இன்று ${newTime} மணிக்கு.` : `${date} அன்று ${newTime} மணிக்கு.`) +
        ` உறுதிப்படுத்த 1, மாற்ற 2 என பதிலளிக்கவும்.`
      );

    case "Hindi":
      return (
        `${d.hospitalName}: ` +
        `${isEmergency ? "एक इमरजेंसी के कारण" : "समय-सारणी में बदलाव के कारण"} ` +
        `आपकी अपॉइंटमेंट अब ${d.previousDoctorName} की जगह ${d.doctorName} के साथ ` +
        (today ? `आज ${newTime} पर है।` : `${date} को ${newTime} पर है।`) +
        ` पुष्टि के लिए 1, बदलने के लिए 2 भेजें।`
      );
  }
}

// The short heads-up for a patient who was NOT affected but whose appointment
// was pushed back to make room. Nothing to answer, so it says "No need to reply".
// (Tamil and Hindi need native-speaker review — see note at the top.)
export function headsUpSms(d: {
  language: Language;
  hospitalName: string;
  doctorName: string;
  minutesLater: number; // how much later than first booked, in total
  newStartTime: string; // "HH:MM"
}): string {
  const newTime = formatTimeFor(d.newStartTime, d.language);
  return {
    English:
      `${d.hospitalName}: your appointment with ${d.doctorName} may start up to ` +
      `${d.minutesLater} minutes later, around ${newTime}. No need to reply.`,
    Tamil:
      `${d.hospitalName}: ${d.doctorName} உடனான உங்கள் சந்திப்பு ${d.minutesLater} நிமிடங்கள் வரை ` +
      `தாமதமாக, சுமார் ${newTime} மணிக்கு தொடங்கலாம். பதிலளிக்க வேண்டியதில்லை.`,
    Hindi:
      `${d.hospitalName}: ${d.doctorName} के साथ आपकी अपॉइंटमेंट ${d.minutesLater} मिनट तक देर से, ` +
      `लगभग ${newTime} पर शुरू हो सकती है। जवाब देने की ज़रूरत नहीं है।`,
  }[d.language];
}
