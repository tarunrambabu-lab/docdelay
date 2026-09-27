// Extra lines DocDelay says in CHAT mode, in the patient's language.
// (Offers and "your new time is…" reuse the wording in callScript.ts.)
//
// ⚠️ The Tamil and Hindi wording was written for this demo and must be
// checked by native speakers before real use.
//
// SAFETY: nothing here may give medical advice. The urgent line only
// connects the patient to staff and points to emergency services.

import type { Language } from "@/hms/types";

// The fixed line for ANY health concern. Never change it into advice.
export function urgentReply(language: Language): string {
  return {
    English:
      "I'm connecting you to our staff now. If this is an emergency, please call 108 or go to the nearest emergency department.",
    Tamil:
      "உங்களை இப்போது எங்கள் ஊழியர்களுடன் இணைக்கிறேன். இது அவசரநிலை என்றால், தயவுசெய்து 108 ஐ அழைக்கவும் அல்லது அருகிலுள்ள அவசர சிகிச்சைப் பிரிவுக்குச் செல்லவும்.",
    Hindi:
      "आपको अभी हमारे स्टाफ़ से जोड़ा जा रहा है। अगर यह इमरजेंसी है, तो कृपया 108 पर कॉल करें या नज़दीकी इमरजेंसी विभाग में जाएँ।",
  }[language];
}

export function staffWillCallReply(language: Language): string {
  return {
    English: "Our front desk will call you shortly.",
    Tamil: "எங்கள் வரவேற்பு மேசையிலிருந்து விரைவில் உங்களை அழைப்பார்கள்.",
    Hindi: "हमारा फ्रंट डेस्क जल्द ही आपको कॉल करेगा।",
  }[language];
}

export function cancelledReply(language: Language): string {
  return {
    English: "Your appointment has been cancelled. Thank you.",
    Tamil: "உங்கள் சந்திப்பு ரத்து செய்யப்பட்டது. நன்றி.",
    Hindi: "आपकी अपॉइंटमेंट रद्द कर दी गई है। धन्यवाद।",
  }[language];
}

// After a reply that couldn't be understood (the first time).
export function unclearReply(language: Language, hasOffers: boolean): string {
  const base = {
    English:
      "Sorry, I didn't understand. You can say: wait for later today, another day, or cancel.",
    Tamil:
      "மன்னிக்கவும், புரியவில்லை. இன்று பின்னர் காத்திருக்க, வேறு நாள், அல்லது ரத்து என்று சொல்லலாம்.",
    Hindi: "माफ़ कीजिए, समझ नहीं आया। आप कह सकते हैं: आज बाद में इंतज़ार, कोई और दिन, या रद्द।",
  }[language];
  const offers = {
    English: " Or choose A, B or C.",
    Tamil: " அல்லது A, B அல்லது C ஐத் தேர்ந்தெடுக்கவும்.",
    Hindi: " या A, B या C चुनें।",
  }[language];
  return hasOffers ? base + offers : base;
}

// Asked when the patient gave a time but no day (e.g. "after 4").
export function askTodayOrAnotherDay(language: Language): string {
  return {
    English: "Do you mean today, or another day?",
    Tamil: "இன்றைக்கா, அல்லது வேறு நாளுக்கா?",
    Hindi: "क्या आपका मतलब आज से है, या किसी और दिन से?",
  }[language];
}

// Put in front of the offers when nothing matched what the patient asked for.
export function noMatchPrefix(language: Language): string {
  return {
    English: "Sorry, nothing is free at that time.",
    Tamil: "மன்னிக்கவும், அந்த நேரத்தில் இடம் இல்லை.",
    Hindi: "माफ़ कीजिए, उस समय कोई जगह खाली नहीं है।",
  }[language];
}

// Put in front of other-day offers when the patient asked for a time TODAY
// and no empty slot fits (chosen times are only booked within normal hours).
export function noFreeTodayPrefix(language: Language): string {
  return {
    English: "Sorry, nothing is free today at that time.",
    Tamil: "மன்னிக்கவும், இன்று அந்த நேரத்தில் இடம் இல்லை.",
    Hindi: "माफ़ कीजिए, आज उस समय कोई जगह खाली नहीं है।",
  }[language];
}

// Put in front of fresh offers when the chosen slot was taken meanwhile.
export function slotTakenPrefix(language: Language): string {
  return {
    English: "Sorry, that time was just taken.",
    Tamil: "மன்னிக்கவும், அந்த நேரம் இப்போது தான் நிரம்பிவிட்டது.",
    Hindi: "माफ़ कीजिए, वह समय अभी-अभी बुक हो गया।",
  }[language];
}
