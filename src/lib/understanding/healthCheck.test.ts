// Tests for the keyword health check (run with: npm test).
//
// Every message goes through interpretWithRules — the same function the chat
// uses — and also through mentionsHealth, the safety net that runs before the
// AI. Both must agree.
//
// "🗣️ needs native-speaker check" = written for these tests; a native speaker
// should confirm people really say it this way.
import { describe, expect, it } from "vitest";
import { interpretWithRules, mentionsHealth } from "@/lib/understanding";

const context = { language: "English" as const, offers: [] };

// A. Anything about health MUST go URGENT.
const MUST_ESCALATE = [
  // English, direct and indirect
  "I have chest pain",
  "my chest feels tight",
  "there is some heaviness in my chest",
  "I am short of breath",
  "I feel dizzy",
  "I fainted this morning",
  "I'm feeling unwell",
  "I'm not feeling right",
  "something feels off since yesterday",
  "my left arm has gone numb",
  "I'm sweating a lot and feel uneasy",
  "my BP has been going up",
  "I've been vomiting since morning",
  "there is some bleeding",
  "my heart is racing",
  "my legs are swollen",
  // Symptom mentioned even though it's denied — still escalates
  "no chest pain now, just want to reschedule",
  // Typos
  "chest pian",
  "feeling dizy",
  // About a family member
  "my father has chest pain, can we move the appointment",
  "my mother is feeling dizzy, she can't come",
  // "doctor said" + a symptom
  "doctor said my BP is high",
  "doctor said to come if the chest pain returns",
  "the doctor said I should rest, I'm feeling dizzy",
  "doctor said my sugar is very high",
  // A health word mixed into a scheduling message
  "can I come after 4, my chest is paining",
  "Thursday is fine but I have a fever",
  "I'll wait, but I'm feeling a bit dizzy",
  "cancel it, I'm in hospital after an accident",
  "tired of waiting and my chest feels heavy", // harmless phrase + a real symptom
  "nenjaara nandri, aana nenju vali irukku", // heartfelt thanks, but I have chest pain
  "கனமழை, நெஞ்சு வலிக்குது", // kanamazhai, nenju valikkudhu = heavy rain, chest hurts
  // Tamil (romanised)
  "nenju iruku", // chest feels tight — 🗣️ needs native-speaker check
  "enakku nenju vali", // I have chest pain — 🗣️ needs native-speaker check
  "thala suthudhu", // dizzy — 🗣️ needs native-speaker check
  "udambu sari illa", // unwell — 🗣️ needs native-speaker check
  "moochu vida mudiyala", // can't breathe — 🗣️ needs native-speaker check
  "Yenna amma ku nenju vali irruku", // mother has chest pain — checked by native speaker
  "appa ku nenju vali irukku", // father has chest pain — 🗣️ needs native-speaker check
  "thala valikkudhu", // head hurts
  "vayiru vali", // stomach pain
  "kaichal irukku", // I have a fever
  "nenju vali", // chest pain
  "marathu pochu", // gone numb
  // Tamil (romanised) with word endings
  "valikudu", // hurts
  "valikkithu", // hurts
  "kaichala irukku", // I have a fever
  "kaichalaa irukku",
  "kaaychal irukku",
  "juramaa irukku", // I have a fever
  "mayakkamaa irukku", // I feel faint
  "mayakkama varudhu",
  "nenjula oru maadhiri irukku", // chest feels strange
  "rathama varudhu", // bleeding
  "vaanthiyaa varudhu", // feel like vomiting
  "vaandhi edukkudhu", // vomiting
  "moocha vida mudiyala", // can't breathe
  "udambukku mudiyala", // body can't cope
  "sorvaa irukku", // feeling tired
  "kiru kirunu irukku", // feeling dizzy
  // Hindi (romanised)
  "seena bhaari lag raha hai", // chest feels heavy — 🗣️ needs native-speaker check
  "mujhe chakkar aa raha hai", // I feel dizzy
  "saans phool rahi hai", // breathless — 🗣️ needs native-speaker check
  "tabiyat theek nahi hai", // unwell
  "Mera mummy seene mein dard hai", // mother has chest pain — checked by native speaker
  "papa ke seene me dard hai", // father has chest pain — 🗣️ needs native-speaker check
  // Hindi (romanised) with word endings or other spellings
  "sardard hai", // headache
  "dardh ho raha", // pain
  "bimari hai", // illness
  "bimaari",
  "kamzor lag raha", // feeling weak
  "behoshi", // unconsciousness
  "ultiyan", // vomiting
  "chakkarr", // dizzy
  "saanson mein takleef", // trouble breathing
  "davai", // medicine
  "tabiyet kharab", // unwell
  "saans lene mein takleef", // trouble breathing
  "seene mein takleef", // chest trouble
  "takleef ho rahi hai", // I'm having trouble / discomfort
  // Mixed language
  "leg pain-aa irukku", // Tamil + English
  "BP high hai", // Hindi + English
  // Tamil script
  "நெஞ்சு வலிக்குது", // chest pain — 🗣️ needs native-speaker check
  "எனக்கு மயக்கமா இருக்கு", // I feel faint — 🗣️ needs native-speaker check
  "கால் வலிக்குது", // kaal valikkudhu = leg hurts
  "தலை வலிக்குது", // thalai valikkudhu = head hurts
  "வயிறு வலிக்குது", // vayiru valikkudhu = stomach hurts
  "காய்ச்சலா இருக்கு", // kaaychalaa irukku = I have a fever
  "நெஞ்சுல வலி", // nenjula vali = pain in the chest
  "மூச்சை விட முடியல", // moochai vida mudiyala = can't breathe
  "ரத்தமா வருது", // rathamaa varudhu = bleeding
  "ரத்த அழுத்தம் அதிகமா இருக்கு", // ratha azhuththam adhigamaa irukku = BP is high
  "வாந்தியா வருது", // vaanthiyaa varudhu = feel like vomiting
  "உடம்புக்கு முடியல", // udambukku mudiyala = body can't cope
  "ஜுரமா இருக்கு", // juramaa irukku = I have a fever
  "தலை சுத்துது", // thalai suthudhu = dizzy
  "கிறுகிறுன்னு இருக்கு", // kiru kirunu irukku = dizzy
  "மரத்துப் போச்சு", // marathu pochu = gone numb
  "மயங்கி விழுந்தேன்", // mayangi vizhundhen = I fainted and fell
  // Hindi script
  "सीने में दर्द है", // chest pain
  "मुझे चक्कर आ रहा है", // I feel dizzy
];

// B. Scheduling messages must NOT go URGENT.
const MUST_NOT_ESCALATE = [
  // Normal replies
  "later today",
  "I'll wait", // "I'll" must not be read as "ill"
  "cancel",
  "please cancel my appointment",
  "Thursday after 4",
  "tomorrow morning",
  "another day please",
  "can I come next week",
  "B",
  "the second one",
  "after 4",
  "I want to talk to someone",
  // Tamil
  "naan wait panren", // 🗣️ needs native-speaker check
  "naalai kaalaila", // tomorrow morning — 🗣️ needs native-speaker check
  "vera naal venum", // another day — 🗣️ needs native-speaker check
  "cancel pannidunga", // 🗣️ needs native-speaker check
  "நாளை காலை", // tomorrow morning — 🗣️ needs native-speaker check
  // Hindi
  "kal subah", // tomorrow morning
  "main ruk jaunga", // I'll wait
  "koi aur din chahiye", // another day
  "4 baje ke baad", // after 4
  "कल सुबह", // tomorrow morning
  // Alarm-fatigue phrases
  "I'm tired of waiting",
  "heavy traffic, I'll come later",
  "work pressure, can we do another day",
  "doctor said I can't miss this appointment",
  "sick of all the delays, move it to Friday",
  "intezaar karke thak gaya", // tired of waiting — 🗣️ needs native-speaker check
  // English words that start like the Tamil word for pain ("vali")
  "is my appointment still valid",
  "valid for tomorrow?",
  "validity of my booking",
  // Words that start like a health word but aren't about health
  "ultimately I want Thursday", // "ulti" = vomiting (Hindi)
  "vandhitten", // Tamil: I have come ("vaanthi" = vomit)
  "takleef ke liye maafi", // Hindi: sorry for the trouble
  "nenjaara nandri", // Tamil: heartfelt thanks ("nenju" = chest)
  "நெஞ்சார்ந்த நன்றி", // nenjaarndha nandri = heartfelt thanks
  "kanamazhai, late aaguven", // Tamil: heavy rain, I'll be late
  "கனமழை, லேட் ஆகும்", // kanamazhai, late aagum = heavy rain, will be late
  "marathadi wait panren", // Tamil: waiting under the tree ("marathu pochu" = numb)
  "மரத்தடியில காத்திருக்கேன்", // marathadiyila kaathirukken = waiting under the tree
];

describe("A. health phrases go URGENT", () => {
  it.each(MUST_ESCALATE)("%s", async (message) => {
    expect(mentionsHealth(message)).toBe(true);
    expect((await interpretWithRules(message, context)).intent).toBe("health_concern");
  });
});

describe("B. scheduling messages do NOT go URGENT", () => {
  it.each(MUST_NOT_ESCALATE)("%s", async (message) => {
    expect(mentionsHealth(message)).toBe(false);
    expect((await interpretWithRules(message, context)).intent).not.toBe("health_concern");
  });
});
