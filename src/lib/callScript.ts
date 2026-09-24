// What DocDelay "says" when it calls a patient, in their preferred language.
//
// ⚠️ IMPORTANT: The Tamil and Hindi wording below was written for this demo
// and has NOT been checked by a native speaker. Before any real patient hears
// these messages, a native Tamil speaker and a native Hindi speaker must
// review and correct them (including how times like "10:15 AM" are read out).
//
// The wording avoids "he"/"she" for the doctor ("the doctor expects to be
// back…"), so we never have to guess anyone's pronouns.

import type { Language, UnavailabilityReason } from "@/hms/types";

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

// What DocDelay says after the patient presses "1 – Later today".
// newTime is e.g. "2:15 PM", or null if there was no room today.
// (Tamil and Hindi need native-speaker review — see note at the top.)
export function laterTodayReply(language: Language, newTime: string | null): string {
  if (newTime) {
    return {
      English: `Thank you. Your new time is ${newTime} today.`,
      Tamil: `நன்றி. உங்கள் புதிய நேரம் இன்று ${newTime}.`,
      Hindi: `धन्यवाद। आपका नया समय आज ${newTime} है।`,
    }[language];
  }
  return {
    English: "Sorry, there is no free time left today. Our front desk will call you shortly.",
    Tamil:
      "மன்னிக்கவும், இன்று நேரம் எதுவும் இல்லை. எங்கள் வரவேற்பு மேசையிலிருந்து விரைவில் உங்களை அழைப்பார்கள்.",
    Hindi: "माफ़ कीजिए, आज कोई समय खाली नहीं है। हमारा फ्रंट डेस्क जल्द ही आपको कॉल करेगा।",
  }[language];
}
