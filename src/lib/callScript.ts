// What DocDelay "says" when it calls a patient, in their preferred language.
//
// ⚠️ IMPORTANT: The Tamil and Hindi wording below was written for this demo
// and has NOT been checked by a native speaker. Before any real patient hears
// these messages, a native Tamil speaker and a native Hindi speaker must
// review and correct them (including how times like "10:15 AM" are read out).
//
// The wording avoids "he"/"she" for the doctor ("the doctor expects to be
// back…"), so we never have to guess anyone's pronouns.

import type { Language, SlotOffer, UnavailabilityReason } from "@/hms/types";
import { formatDate, formatTime } from "@/lib/time";

// Letters used for the offers: A) … B) … C) …
export const OFFER_LETTERS = ["A", "B", "C", "D", "E"];

export interface CallScriptDetails {
  language: Language;
  patientName: string;
  hospitalName: string;
  doctorName: string;
  reason: UnavailabilityReason;
  appointmentTime: string; // already formatted, e.g. "10:15 AM"
  untilTime: string; // already formatted, e.g. "1:15 PM"
}

export function callScript(d: CallScriptDetails): string {
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

// What DocDelay says after the patient presses "1 – Later today" and gets
// a new time, e.g. newTime = "2:15 PM".
// (Tamil and Hindi need native-speaker review — see note at the top.)
export function laterTodayReply(language: Language, newTime: string): string {
  return {
    English: `Thank you. Your new time is ${newTime} today.`,
    Tamil: `நன்றி. உங்கள் புதிய நேரம் இன்று ${newTime}.`,
    Hindi: `धन्यवाद। आपका नया समय आज ${newTime} है।`,
  }[language];
}

// Reads out the other-day offers, e.g. "We can offer: A) Mon 28 Sep, 10:15 AM,
// B) …". If the patient pressed 1 but today was full, it starts with an apology.
// (Tamil and Hindi need native-speaker review — see note at the top.)
export function otherDayOffersScript(
  language: Language,
  offers: SlotOffer[],
  noRoomToday: boolean,
): string {
  const list = offers
    .map(
      (o, i) =>
        `${OFFER_LETTERS[i]}) ${formatDate(o.dayOffset, language)}, ${formatTime(o.startTime)}`,
    )
    .join(", ");
  // "A, B or C" (with the word for "or" in each language); just "A" if there's one offer.
  const letters = (or: string) => {
    const l = OFFER_LETTERS.slice(0, offers.length);
    return l.length === 1 ? l[0] : `${l.slice(0, -1).join(", ")} ${or} ${l.at(-1)}`;
  };

  switch (language) {
    case "English":
      return (
        (noRoomToday ? "Sorry, there is no free time left today. " : "") +
        `We can offer: ${list}. ` +
        `Please choose ${letters("or")}. If none of these suit you, our front desk will call you.`
      );
    case "Tamil":
      return (
        (noRoomToday ? "மன்னிக்கவும், இன்று நேரம் எதுவும் இல்லை. " : "") +
        `நாங்கள் வழங்கக்கூடிய நேரங்கள்: ${list}. ` +
        `${letters("அல்லது")} இல் ஒன்றைத் தேர்ந்தெடுக்கவும். இவை எதுவும் பொருந்தவில்லை என்றால், எங்கள் வரவேற்பு மேசையிலிருந்து உங்களை அழைப்பார்கள்.`
      );
    case "Hindi":
      return (
        (noRoomToday ? "माफ़ कीजिए, आज कोई समय खाली नहीं है। " : "") +
        `हम ये समय दे सकते हैं: ${list}। ` +
        `${letters("या")} में से एक चुनें। अगर इनमें से कोई भी ठीक नहीं है, तो हमारा फ्रंट डेस्क आपको कॉल करेगा।`
      );
  }
}

// What DocDelay says after the patient picks one of the other-day offers.
// (Tamil and Hindi need native-speaker review — see note at the top.)
export function anotherDayReply(language: Language, dayOffset: number, time: string): string {
  const date = formatDate(dayOffset, language);
  const at = formatTime(time);
  return {
    English: `Thank you. Your new appointment is on ${date} at ${at}.`,
    Tamil: `நன்றி. உங்கள் புதிய சந்திப்பு ${date} அன்று ${at} மணிக்கு.`,
    Hindi: `धन्यवाद। आपकी नई अपॉइंटमेंट ${date} को ${at} पर है।`,
  }[language];
}
