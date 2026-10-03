// What DocDelay "says" when it calls a patient, in their preferred language.
//
// ⚠️ IMPORTANT: The Tamil and Hindi wording below was written for this demo
// and has NOT been checked by a native speaker. Before any real patient hears
// these messages, a native Tamil speaker and a native Hindi speaker must
// review and correct them (including how times are written — see formatTimeFor
// in lib/time.ts: e.g. Tamil "மாலை 4:30 (4:30 PM)", Hindi "शाम 4:30 (4:30 PM)").
//
// Every time shown to a patient goes through formatTimeFor, so it always has
// AM/PM — plus the local time-of-day word in Tamil and Hindi.
//
// The wording avoids "he"/"she" for the doctor ("the doctor expects to be
// back…"), so we never have to guess anyone's pronouns.

import type { Language, SlotOffer, UnavailabilityReason } from "@/hms/types";
import { formatDate, formatTimeFor } from "@/lib/time";

// Letters used for the offers: A) … B) … C) …
export const OFFER_LETTERS = ["A", "B", "C", "D", "E"];

export interface CallScriptDetails {
  language: Language;
  patientName: string;
  hospitalName: string;
  doctorName: string;
  reason: UnavailabilityReason;
  appointmentTime: string; // "HH:MM", e.g. "10:15"
  untilTime: string; // "HH:MM" — the doctor's expected return
  // Buttons only: add "Press 5 to see another doctor from the same department
  // today" (only when there's a slot — the hms module checks).
  anotherDoctorToday?: boolean;
}

export function callScript(details: CallScriptDetails): string {
  const menu = callMenuScript(details);
  return details.anotherDoctorToday ? `${menu} ${ANOTHER_DOCTOR_LINE[details.language]}` : menu;
}

// "5 – Another doctor today" (Buttons only), said at the end of the opening.
// (Tamil and Hindi need native-speaker review — see note at the top.)
const ANOTHER_DOCTOR_LINE: Record<Language, string> = {
  English: "Press 5 to see another doctor from the same department today.",
  Tamil: "இன்றே அதே பிரிவைச் சேர்ந்த வேறு மருத்துவரைப் பார்க்க 5 ஐ அழுத்தவும்.",
  Hindi: "आज ही उसी विभाग के किसी दूसरे डॉक्टर से मिलने के लिए 5 दबाएँ।",
};

// The opening message with options 1–4 (unchanged; chat mode uses only this).
function callMenuScript(details: CallScriptDetails): string {
  // Times as the patient should see them (e.g. "காலை 10:15 (10:15 AM)").
  const d = {
    ...details,
    appointmentTime: formatTimeFor(details.appointmentTime, details.language),
    untilTime: formatTimeFor(details.untilTime, details.language),
  };
  switch (d.language) {
    case "English": {
      const why = {
        "Emergency surgery": "has been called in for an emergency surgery",
        "Personal emergency": "has had a personal emergency",
        Other: "has been unexpectedly called away",
      }[d.reason];
      return (
        `Hello ${d.patientName}, this is ${d.hospitalName}. ` +
        `${d.doctorName} ${why} and won't be available at your ${d.appointmentTime} appointment. ` +
        `The doctor expects to be back around ${d.untilTime}. ` +
        `Would you like to: 1) wait for a later slot today, 2) move to another day, or 3) cancel? ` +
        `Press 4 to speak with our front desk.`
      );
    }

    case "Tamil": {
      // Needs native-speaker review (see note at the top).
      const why = {
        "Emergency surgery": "அவசர அறுவை சிகிச்சைக்கு அழைக்கப்பட்டுள்ளார்",
        "Personal emergency": "அவர்களுக்கு தனிப்பட்ட அவசர நிலை ஏற்பட்டுள்ளது",
        Other: "எதிர்பாராத விதமாக வெளியே செல்ல வேண்டியதாயிற்று",
      }[d.reason];
      return (
        `வணக்கம் ${d.patientName}, இது ${d.hospitalName} இலிருந்து அழைப்பு. ` +
        `${d.doctorName} ${why}. எனவே உங்கள் ${d.appointmentTime} சந்திப்பின் போது மருத்துவர் இருக்க மாட்டார். ` +
        `மருத்துவர் சுமார் ${d.untilTime} மணிக்கு திரும்பி வருவார் என எதிர்பார்க்கப்படுகிறது. ` +
        `நீங்கள் விரும்புவது: 1) இன்று பின்னர் வேறு நேரத்திற்கு காத்திருக்க, 2) வேறு நாளுக்கு மாற்ற, அல்லது 3) ரத்து செய்ய? ` +
        `எங்கள் வரவேற்பு மேசையுடன் பேச 4 ஐ அழுத்தவும்.`
      );
    }

    case "Hindi": {
      // Needs native-speaker review (see note at the top).
      const why = {
        "Emergency surgery": "को एक इमरजेंसी सर्जरी के लिए बुलाया गया है",
        "Personal emergency": "को एक निजी इमरजेंसी आ गई है",
        Other: "को अचानक किसी ज़रूरी काम से जाना पड़ा है",
      }[d.reason];
      return (
        `नमस्ते ${d.patientName}, यह ${d.hospitalName} से कॉल है। ` +
        `${d.doctorName} ${why}, इसलिए आपकी ${d.appointmentTime} की अपॉइंटमेंट के समय डॉक्टर उपलब्ध नहीं हैं। ` +
        `डॉक्टर के लगभग ${d.untilTime} तक वापस आने की उम्मीद है। ` +
        `क्या आप: 1) आज बाद के किसी समय का इंतज़ार करना चाहेंगे, 2) किसी और दिन आना चाहेंगे, या 3) अपॉइंटमेंट रद्द करना चाहेंगे? ` +
        `हमारे फ्रंट डेस्क से बात करने के लिए 4 दबाएँ।`
      );
    }
  }
}

// What DocDelay says after the patient gets a new time today. Takes the raw
// time ("14:15") and always writes it with AM/PM ("2:15 PM"; in Tamil and
// Hindi with the local time-of-day word too).
// (Tamil and Hindi need native-speaker review — see note at the top.)
export function laterTodayReply(language: Language, startTime: string): string {
  const newTime = formatTimeFor(startTime, language);
  return {
    English: `Thank you. Your new time is ${newTime} today.`,
    Tamil: `நன்றி. உங்கள் புதிய நேரம் இன்று ${newTime}.`,
    Hindi: `धन्यवाद। आपका नया समय आज ${newTime} है।`,
  }[language];
}

// The word for "today" in each language (used when an offer is for today).
const TODAY: Record<Language, string> = { English: "today", Tamil: "இன்று", Hindi: "आज" };

// How an offer's day is written to a patient: "today" or the date, in their language.
export function dayLabelFor(dayOffset: number, language: Language): string {
  return dayOffset === 0 ? TODAY[language] : formatDate(dayOffset, language);
}

// Reads out the offers, e.g. "We can offer: A) Mon 28 Sep, 10:15 AM, B) …".
// Offers can be for other days or for today ("A) today, 4:00 PM").
// If the patient pressed 1 but today was full, it starts with an apology.
// `intro` replaces "We can offer:" (e.g. "The closest I can offer is:").
// (Tamil and Hindi need native-speaker review — see note at the top.)
export function otherDayOffersScript(
  language: Language,
  offers: SlotOffer[],
  noRoomToday: boolean,
  intro?: string,
): string {
  const list = offers
    .map(
      (o, i) =>
        `${OFFER_LETTERS[i]}) ${dayLabelFor(o.dayOffset, language)}, ${formatTimeFor(o.startTime, language)}`,
    )
    .join(", ");

  switch (language) {
    case "English":
      return (
        (noRoomToday ? "Sorry, there is no free time left today. " : "") +
        `${intro ?? "We can offer:"} ${list}. ` +
        pleaseChoose(language, offers.length)
      );
    case "Tamil":
      return (
        (noRoomToday ? "மன்னிக்கவும், இன்று நேரம் எதுவும் இல்லை. " : "") +
        `${intro ?? "நாங்கள் வழங்கக்கூடிய நேரங்கள்:"} ${list}. ` +
        pleaseChoose(language, offers.length)
      );
    case "Hindi":
      return (
        (noRoomToday ? "माफ़ कीजिए, आज कोई समय खाली नहीं है। " : "") +
        `${intro ?? "हम ये समय दे सकते हैं:"} ${list}। ` +
        pleaseChoose(language, offers.length)
      );
  }
}

// "Please choose A, B or C. If none of these suit you, our front desk will
// call you." — the end of every list of offers. `count` = how many offers.
// (Tamil and Hindi need native-speaker review — see note at the top.)
function pleaseChoose(language: Language, count: number): string {
  // "A, B or C" (with the word for "or" in each language); just "A" if there's one offer.
  const letters = (or: string) => {
    const l = OFFER_LETTERS.slice(0, count);
    return l.length === 1 ? l[0] : `${l.slice(0, -1).join(", ")} ${or} ${l.at(-1)}`;
  };
  return {
    English: `Please choose ${letters("or")}. If none of these suit you, our front desk will call you.`,
    Tamil: `${letters("அல்லது")} இல் ஒன்றைத் தேர்ந்தெடுக்கவும். இவை எதுவும் பொருந்தவில்லை என்றால், எங்கள் வரவேற்பு மேசையிலிருந்து உங்களை அழைப்பார்கள்.`,
    Hindi: `${letters("या")} में से एक चुनें। अगर इनमें से कोई भी ठीक नहीं है, तो हमारा फ्रंट डेस्क आपको कॉल करेगा।`,
  }[language];
}

// What DocDelay says after the patient picks one of the other-day offers
// (the time always has AM/PM — and the local time-of-day word in Tamil/Hindi).
// (Tamil and Hindi need native-speaker review — see note at the top.)
export function anotherDayReply(language: Language, dayOffset: number, time: string): string {
  const date = formatDate(dayOffset, language);
  const at = formatTimeFor(time, language);
  return {
    English: `Thank you. Your new appointment is on ${date} at ${at}.`,
    Tamil: `நன்றி. உங்கள் புதிய சந்திப்பு ${date} அன்று ${at} மணிக்கு.`,
    Hindi: `धन्यवाद। आपकी नई अपॉइंटमेंट ${date} को ${at} पर है।`,
  }[language];
}

// "5 – Another doctor today": read out the options, e.g. "Another doctor from
// the same department can see you today: A) Dr. Karthik Raman, 11:30 AM, …".
// All offers are for today. `doctorNames` are already in the patient's
// language (see doctorNameFor), one per offer.
// (Tamil and Hindi need native-speaker review — see note at the top.)
export function anotherDoctorOffersScript(
  language: Language,
  offers: { startTime: string; doctorName: string }[],
): string {
  const intro = {
    English: "Another doctor from the same department can see you today:",
    Tamil: "அதே பிரிவைச் சேர்ந்த வேறு மருத்துவர் இன்று உங்களைப் பார்க்க முடியும்:",
    Hindi: "उसी विभाग के एक दूसरे डॉक्टर आज आपसे मिल सकते हैं:",
  }[language];
  const list = offers
    .map((o, i) => `${OFFER_LETTERS[i]}) ${o.doctorName}, ${formatTimeFor(o.startTime, language)}`)
    .join(", ");
  const stop = language === "Hindi" ? "।" : ".";
  return `${intro} ${list}${stop} ${pleaseChoose(language, offers.length)}`;
}

// What DocDelay says after the patient books with another doctor today.
// `doctorName` is already in the patient's language (see doctorNameFor).
// (Tamil and Hindi need native-speaker review — see note at the top.)
export function anotherDoctorReply(language: Language, time: string, doctorName: string): string {
  const at = formatTimeFor(time, language);
  return {
    English: `Thank you. Your new appointment is today at ${at} with ${doctorName}.`,
    Tamil: `நன்றி. உங்கள் புதிய சந்திப்பு இன்று ${at} மணிக்கு ${doctorName} உடன்.`,
    Hindi: `धन्यवाद। आपकी नई अपॉइंटमेंट आज ${at} पर ${doctorName} के साथ है।`,
  }[language];
}

// ---------- WhatsApp: DocDelay's first message ----------
// The same choices as the call, reworded for WhatsApp ("Reply 4…" instead of
// "Press 4…", plus "Reply with a number or tap an option").
//
// PRIVACY (FRD 6.1): a WhatsApp preview can show on a locked phone, so this
// message names ONLY the hospital, the doctor and the time. It never has:
//   - the patient's name (there's no `patientName` here on purpose);
//   - the doctor's real reason: it always uses the call's "Other" line
//     ("has been unexpectedly called away"), whatever the reason was;
//   - the reason for the visit.
// ⚠️ The new Tamil and Hindi lines (opening, 4, 5, closing) are NOT yet
// native-checked (BACKLOG.md). The rest is the call's own wording.
export type WhatsAppScriptDetails = Omit<CallScriptDetails, "patientName" | "reason">;

export function whatsappScript(details: WhatsAppScriptDetails): string {
  const d = {
    ...details,
    appointmentTime: formatTimeFor(details.appointmentTime, details.language),
    untilTime: formatTimeFor(details.untilTime, details.language),
  };
  switch (d.language) {
    case "English":
      return (
        `Hello, this is a message from ${d.hospitalName}. ` +
        `${d.doctorName} has been unexpectedly called away and won't be available at your ${d.appointmentTime} appointment. ` +
        `The doctor expects to be back around ${d.untilTime}. ` +
        `Would you like to: 1) wait for a later slot today, 2) move to another day, or 3) cancel? ` +
        `Reply 4 to speak with our front desk.` +
        (d.anotherDoctorToday
          ? ` Reply 5 to see another doctor from the same department today.`
          : "") +
        ` Reply with a number or tap an option.`
      );

    case "Tamil":
      return (
        `வணக்கம், இது ${d.hospitalName} இலிருந்து செய்தி. ` +
        `${d.doctorName} எதிர்பாராத விதமாக வெளியே செல்ல வேண்டியதாயிற்று. எனவே உங்கள் ${d.appointmentTime} சந்திப்பின் போது மருத்துவர் இருக்க மாட்டார். ` +
        `மருத்துவர் சுமார் ${d.untilTime} மணிக்கு திரும்பி வருவார் என எதிர்பார்க்கப்படுகிறது. ` +
        `நீங்கள் விரும்புவது: 1) இன்று பின்னர் வேறு நேரத்திற்கு காத்திருக்க, 2) வேறு நாளுக்கு மாற்ற, அல்லது 3) ரத்து செய்ய? ` +
        `எங்கள் வரவேற்பு மேசையுடன் பேச 4 என பதிலளிக்கவும்.` +
        (d.anotherDoctorToday
          ? ` இன்றே அதே பிரிவைச் சேர்ந்த வேறு மருத்துவரைப் பார்க்க 5 என பதிலளிக்கவும்.`
          : "") +
        ` ஒரு எண்ணை அனுப்பவும் அல்லது ஒரு விருப்பத்தைத் தட்டவும்.`
      );

    case "Hindi":
      return (
        `नमस्ते, यह ${d.hospitalName} से संदेश है। ` +
        `${d.doctorName} को अचानक किसी ज़रूरी काम से जाना पड़ा है, इसलिए आपकी ${d.appointmentTime} की अपॉइंटमेंट के समय डॉक्टर उपलब्ध नहीं हैं। ` +
        `डॉक्टर के लगभग ${d.untilTime} तक वापस आने की उम्मीद है। ` +
        `क्या आप: 1) आज बाद के किसी समय का इंतज़ार करना चाहेंगे, 2) किसी और दिन आना चाहेंगे, या 3) अपॉइंटमेंट रद्द करना चाहेंगे? ` +
        `हमारे फ्रंट डेस्क से बात करने के लिए 4 भेजें।` +
        (d.anotherDoctorToday
          ? ` आज ही उसी विभाग के किसी दूसरे डॉक्टर से मिलने के लिए 5 भेजें।`
          : "") +
        ` कोई नंबर भेजें या कोई विकल्प चुनें।`
      );
  }
}
