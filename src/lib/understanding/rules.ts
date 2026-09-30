// The RULE-BASED stand-in for understanding patient chat messages.
// Keyword and pattern matching for English, romanised Tamil and romanised
// Hindi (plus a few words in Tamil and Devanagari script for health concerns).
// It's free and predictable, but much less flexible than a real AI.
//
// ⚠️ The Tamil and Hindi word lists were written for this demo and must be
// reviewed and extended by native speakers before real use.
//
// Order of checks (first match wins):
//   1. health concern  — ALWAYS first. Broad on purpose: when unsure, escalate.
//      (Then "NO another doctor" phrases — "I don't want another doctor",
//      "vera doctor venaam" — are removed, so they're never read as asking
//      for one, or as cancelling; the rest of the message is read as usual.)
//   2. talk to a person
//   3. cancel
//   3b. see another doctor today ("another doctor", "vera doctor", "5", …)
//   4. choose one of the offers read out (A/B/C, or its day/time)
//   5. another day (a day word, a date, "another day", …)
//   6. later today ("wait", "later", "today", …)
//   7. a time preference with no day ("after 4") → ask "today, or another day?"
//   8. otherwise: unclear

import type { Understander, Preferences, Understanding, UnderstandingContext } from "./types";
import type { TimeOfDay } from "@/lib/reschedulingRules";
import { DAYS_TO_SEARCH } from "@/lib/reschedulingRules";
import { dateForDayOffset, fromMinutes } from "@/lib/time";
import { WEEKDAYS } from "./dayWords";

// ---------- Word lists ----------

// Everyday phrases that use health-sounding words about waiting, traffic,
// rain, work or schedules — "tired of waiting", "heavy traffic", "work
// pressure". To avoid alarm fatigue, ONLY these exact phrases are skipped
// before the health check; every other word in the message is still checked
// ("heavy traffic and my chest feels heavy" still escalates).
// Keep this list SHORT and specific: anything that might be about the
// patient's body stays out of it (when unsure, escalate).
// ⚠️ To be reviewed together with HEALTH_WORDS (native speakers + a clinician).
const HARMLESS_PHRASES: RegExp[] = [
  // tired / exhausted / sick / fed up … of waiting or of the delay
  /\s(tired|exhausted|sick|fed up|bored)\s(of|with|from)\s(all\s)?(the\s|this\s|these\s)?(waiting|wait|delays?|queue|line|rescheduling)(?=\s)/g,
  // Hindi: "intezaar karke thak gaya", "wait karte karte thakan"
  /\s(intezaar|intazar|intezar|wait)(\s[\p{L}]+){0,2}\sthak[\p{L}]*(?=\s)/gu,
  // heavy / bhaari … traffic, rain, work, schedule
  /\s(heavy|bhaari|bhari)\s(traffic|rain|rains|baarish|barish|workload|work|schedule|jam)(?=\s)/g,
  /\s(traffic|baarish|barish)\s(bahut\s)?(bhaari|bhari|heavy)(?=\s)/g,
  // work / office / job / traffic / schedule … pressure
  /\s(work|office|job|traffic|schedule|kaam|naukri)\s(ka\s|ki\s)?(pressure|dabav)(?=\s)/g,
  /\s(pressure|dabav)\s(at|from|of)\s(work|office|my job|the office)(?=\s)/g,
  // Tamil: "nenjaara nandri" = heartfelt thanks ("nenj…" = chest, below).
  // Only this word is skipped; "nenju vali" (chest pain) still escalates.
  /\s(nenjaar|nenjar)[\p{L}]*(?=\s)/gu,
  /\sநெஞ்சார[\p{L}\p{M}]*(?=\s)/gu,
  // Tamil: "kanamazhai" = heavy rain ("kanam…" = heavy, below)
  /\s(kanamazhai|kana mazhai)[\p{L}]*(?=\s)/gu,
  /\s(கனமழை|கன மழை)[\p{L}\p{M}]*(?=\s)/gu,
];

// The message without the harmless phrases above (spaces keep word edges).
function withoutHarmlessPhrases(text: string): string {
  return HARMLESS_PHRASES.reduce((t, phrase) => t.replace(phrase, " "), text);
}
// A trailing "*" means "any word starting with this" (e.g. "breath*" matches
// "breathless", "breathing").

// Anything health-related. False alarms are fine (a false alarm costs one
// staff call); missing a real concern is not. When unsure whether a word is
// health-related, it goes on the list.
//
// ⚠️ This list must be reviewed by a native Tamil speaker, a native Hindi
// speaker AND a clinician before real use — they will know symptom words and
// everyday phrases that are missing here.
const HEALTH_WORDS = [
  // English
  "pain*",
  "ache*",
  "aching",
  "hurt*",
  "chest",
  "heart",
  "breath*",
  "breathe*",
  "cannot breathe",
  "suffocat*",
  "diz*", // dizzy, dizziness — and the typo "dizy"
  "faint*",
  "passed out",
  "collaps*",
  "unconscious",
  "bleed*",
  "blood",
  "vomit*",
  "throwing up",
  "throw up",
  "nause*",
  "fever*",
  "temperature",
  "sick",
  "unwell",
  "ill",
  "not well",
  "not feeling well",
  "feeling bad",
  "feel bad",
  "worse",
  "weak*",
  "numb*",
  "swell*",
  "swollen",
  "seizure*",
  "convuls*",
  "stroke",
  "palpitation*",
  "allerg*",
  "rash*",
  "injur*",
  "accident",
  "fell",
  "fracture*",
  "burn*",
  "emergency",
  "urgent",
  "ambulance",
  "medicine*",
  "medication*",
  "tablet*",
  "pill*",
  "sugar",
  "bp",
  "pressure",
  "pregnan*",
  "headache*",
  "migraine*",
  "cough*",
  "stomach*",
  "diarrh*",
  "loose motion*",
  "infection*",
  "symptom*",
  "sweat*",
  "confusion",
  "shaking",
  "trembling",
  "cramp*",
  "tight*", // tight, tightness, tightening
  "heavy",
  "heaviness",
  "heavi*",
  "uneasy",
  "unease",
  "discomfort",
  "uncomfortable",
  "not right",
  "not feeling good",
  "not feeling great",
  "not feeling ok",
  "not feeling okay",
  "not feeling right",
  "feel off",
  "feels off",
  "feeling off",
  "feel strange",
  "feels strange",
  "feeling strange",
  "feel weird",
  "feels weird",
  "feeling weird",
  "tired",
  "exhausted",
  "fatigue*",
  "pins and needles",
  "tingling",
  "cold sweat*",
  "racing",
  "pounding",
  "clammy",
  "short of breath",
  "shortness of breath",
  // Tamil (romanised). Tamil adds endings to words ("vali" → "valikkudhu"),
  // so most entries are word beginnings. Careful choices:
  //   "valik*", not "vali*"      — "vali*" would catch English "valid"
  //   "vaanthi*", not "vanthi*"  — "vanthi*" would catch "vanthitten" (I have come)
  "vali", // pain
  "valik*", // hurts: valikkudhu, valikudu, valikkithu …
  "nenj*", // chest: nenju, nenjula … ("nenjaara" = heartfelt is skipped, see HARMLESS_PHRASES)
  "nenju vali",
  "mayakka*", // faint / dizzy: mayakkam, mayakkamaa …
  "mayangi*",
  "kaichal*", // fever: kaichal, kaichalaa …
  "kaaichal*",
  "kaaychal*",
  "juram*", // fever
  "udamb*", // body: udambu, udambukku …
  "udambu sari illa",
  "udambu sariyilla",
  "udambu seriyilla",
  "mooch*", // breath: moochu, moocha …
  "mochu",
  "ratham*", // blood: ratham, rathama …
  "rattham*",
  "vaanthi*", // vomit: vaanthi, vaanthiyaa …
  "vaandhi*",
  "vandhi", // whole word only (see above)
  "vanthi",
  "thalai suthuthu",
  "thala suthudhu",
  "thalai suthudhu",
  "nenju iruku", // chest feels tight
  "nenju irukku",
  "nenju irukkama",
  "nenju irukkam",
  "nenju kanama", // chest feels heavy
  "nenju kanam",
  "nenju padapadappu", // palpitations
  "padapadappu",
  "moochu vaanguthu", // breathless
  "moochu vanguthu",
  "moochu vaangudhu",
  "moochu vangudhu",
  "moochu thinaral",
  "moochu vida mudiyala",
  "marathu pochu", // numb
  "maraththu pochu",
  "viyarvai", // sweat
  "vervai",
  "sorv*", // tiredness: sorvu, sorvaa …
  "kiru kiru*", // dizzy: kiru kiru, kiru kirunu …
  "thala sutral",
  "thalai sutral",
  "asowkariyam", // discomfort
  "asoukaryam",
  "enakku sariya illa",
  "udambu mudiyala",
  // Hindi (romanised)
  // Careful choice: "ultiy*", not "ulti*" — "ulti*" would catch English "ultimately".
  // "takleef" (trouble) is NOT on its own: "takleef ke liye maafi" = sorry for the trouble.
  "dard",
  "dardh",
  "sardard", // headache, written as one word
  "sirdard",
  "seene",
  "seena",
  "sine mein",
  "saans*", // breath: saans, saanson …
  "sans",
  "saans lene mein takleef", // trouble breathing
  "seene mein takleef", // chest trouble
  "takleef ho rahi", // I'm having trouble / discomfort
  "chakkar",
  "chakkarr",
  "behosh*", // unconscious: behosh, behoshi …
  "bukhar",
  "bukhaar",
  "ulti",
  "ultiy*", // vomiting: ultiyan …
  "khoon",
  "tabiyat",
  "tabiyet",
  "tabiyat theek nahi",
  "tabiyat kharab",
  "bimar*", // ill / illness: bimar, bimari …
  "beemar*",
  "bimaar*",
  "ghabrahat",
  "kamzor*", // weak / weakness: kamzor, kamzori …
  "dawai",
  "davai",
  "dawa",
  "dava",
  "seena bhaari", // chest feels heavy
  "seene mein bhaaripan",
  "bhaari",
  "bhari",
  "bhaaripan",
  "bechaini", // restlessness / uneasiness
  "bechain",
  "jakdan", // tightness
  "jakdahat",
  "jakad",
  "dabav", // pressure
  "saans phool*", // breathless
  "saans nahi",
  "saans lene",
  "pasina", // sweat
  "paseena",
  "sunn", // numb
  "thakan", // tiredness
  "thakaan",
  "ji machal*", // nausea
  "jee machal*",
  "theek nahi lag*", // not feeling right
  "thik nahi lag*",
  "achha nahi lag*",
  "accha nahi lag*",
  "kuch theek nahi",
  // Tamil script — word beginnings, because Tamil adds endings
  // (vali → valikkudhu, kaaychal → kaaychalaa).
  "வலி*", // vali… = pain, hurts
  "நெஞ்*", // nenj… = chest ("nenjaara" = heartfelt is skipped, see HARMLESS_PHRASES)
  "மயக்க*", // mayakkam (faint/dizzy) with any ending, e.g. mayakkamaa
  "மயங்*", // mayangi… (fainted)
  "காய்ச்சல*", // kaaychal… = fever
  "ஜுரம*", // juram… = fever
  "மூச்ச*", // mooch… = breath
  "ரத்த*", // rath… = blood (also ratha azhuththam = blood pressure)
  "வாந்தி*", // vaanthi… = vomit
  "உடம்ப*", // udamb… = body
  "தலை சுத்து*", // thalai suthudhu = dizzy
  "தல சுத்து*",
  "தலை சுற்று*", // thalai sutru… = dizzy (formal)
  "தலைசுற்ற*",
  "கிறுகிறு*", // kiru kiru = dizzy
  "கிறு கிறு*",
  "இறுக்க*", // tightness (இறுக்கம், இறுக்கமாக)
  "கனம*", // heavy (கனம், கனமாக) — "kanamazhai" = heavy rain is skipped, see HARMLESS_PHRASES
  "வியர்*", // sweat
  "மரத்துப்*", // marathu po… = gone numb (not just "marath…": marathula = in the tree)
  "மரத்து போ*",
  "சோர்*", // tiredness
  // Devanagari (Hindi)
  "दर्द",
  "सीने",
  "सांस",
  "साँस",
  "चक्कर",
  "बेहोश",
  "बुखार",
  "उल्टी",
  "खून",
  "तबीयत",
  "बीमार",
  "दिल",
  "घबराहट",
  "दवा",
  "भारी", // heavy
  "भारीपन",
  "बेचैनी", // uneasiness
  "जकड़न", // tightness
  "दबाव", // pressure
  "पसीना", // sweat
  "सुन्न", // numb
  "थकान", // tiredness
];

const TALK_WORDS = [
  "talk to",
  "talk with",
  "speak to",
  "speak with",
  "person",
  "human",
  "someone",
  "somebody",
  "staff",
  "reception",
  "receptionist",
  "front desk",
  "operator",
  "call me",
  "call back",
  "none of these",
  "none of them",
  "none",
  "neither",
  // Tamil
  "aal kitta",
  "aalu kitta",
  "pesanum",
  "pesa venum",
  "pesa vendum",
  // Hindi
  "baat karni",
  "baat karna",
  "baat karao",
  "kisi se",
  "insaan",
  "aadmi se",
];

const CANCEL_WORDS = [
  "cancel*",
  "do not want",
  "dont want",
  "not coming",
  "will not come",
  "cannot come",
  "no need",
  "not needed",
  "call off",
  // Tamil
  "cancel pannidunga",
  "cancel pannunga",
  "venam",
  "vendam",
  "vendaam",
  "vara maaten",
  "vara mudiyadhu",
  "vara mudiyathu",
  // Hindi
  "cancel kar*",
  "nahi aana",
  "nahi aaunga",
  "nahi aaungi",
  "nahi chahiye",
  "rehne do",
  "mat karo",
];

const LATER_TODAY_WORDS = [
  "wait*",
  "later",
  "this evening",
  "tonight",
  "today",
  "same day",
  "stay",
  "i will stay",
  // Tamil
  "wait panren",
  "wait pannren",
  "wait panuren",
  "wait pannuren",
  "kaathirukk*",
  "kathirukk*",
  "kaathiru*",
  "inniki",
  "innaikku",
  "innikki",
  "indru",
  "inru",
  // Hindi
  "ruk*",
  "intezaar*",
  "intazar*",
  "intezar*",
  "wait kar*",
  "aaj",
  "baad mein",
  "yahin",
];

const ANOTHER_DAY_WORDS = [
  "another day",
  "different day",
  "other day",
  "some other day",
  "next week",
  "reschedule*",
  "change the day",
  "move",
  "postpone*",
  "not today",
  // Tamil
  "vera naal",
  "veroru naal",
  "innoru naal",
  "adutha vaaram",
  "vera naalaikku",
  // Hindi
  "koi aur din",
  "kisi aur din",
  "doosre din",
  "dusre din",
  "agle hafte",
  "aur din",
];

// "See another doctor today" (the same department — the hms module decides
// who). Checked before the offers and "later today", so "doosra doctor" isn't
// read as "option B" and "a different doctor today" isn't read as "wait".
const ANOTHER_DOCTOR_WORDS = [
  "another doctor*",
  "different doctor*",
  "other doctor*",
  "another doc",
  // Tamil
  "vera doctor*",
  "vere doctor*",
  "veroru doctor*",
  "innoru doctor*",
  "vera daktar*",
  "vera maruthuvar*",
  "veroru maruthuvar*",
  "வேறு டாக்டர்*",
  "வேறு மருத்துவர்*",
  "இன்னொரு டாக்டர்*",
  // Hindi
  "doosre doctor",
  "dusre doctor",
  "doosra doctor",
  "dusra doctor",
  "kisi aur doctor",
  "koi aur doctor",
  "दूसरे डॉक्टर",
  "दूसरा डॉक्टर",
  "किसी और डॉक्टर",
  "कोई और डॉक्टर",
];

// "NO another doctor": removed before the other checks (after health), so
// "I don't want another doctor, I'll wait" is read as "I'll wait", and
// "doosra doctor nahi chahiye" isn't read as cancelling the appointment.
// ⚠️ Tamil and Hindi to be reviewed by native speakers.
const DOCTOR_EN = String.raw`(?:another|different|other|new)\s(?:doctor|doc)`;
const DOCTOR_TA = String.raw`(?:vera|vere|veroru|innoru)\s(?:doctor|daktar|maruthuvar)[\p{L}]*`;
const DOCTOR_HI = String.raw`(?:doosre|dusre|doosra|dusra|doosri|dusri|kisi aur|koi aur)\s(?:doctor|daktar)`;
const NOT_ANOTHER_DOCTOR: RegExp[] = [
  // English: "don't want / need another doctor", "not a different doctor". (A bare
  // "no" isn't enough: "No, another doctor please" DOES ask for one.)
  new RegExp(String.raw`\s(?:(?:i\s)?(?:do not|dont|did not|never)\s(?:want|need)(?:\sto\s(?:see|meet))?|not)\s(?:a\s|an\s|any\s)?${DOCTOR_EN}(?=\s)`, "gu"),
  new RegExp(String.raw`\sno need (?:for|of)\s(?:a\s|an\s|any\s)?${DOCTOR_EN}(?=\s)`, "gu"),
  new RegExp(String.raw`\s${DOCTOR_EN}\s(?:is\s)?(?:not needed|not required|not necessary)(?=\s)`, "gu"),
  // Tamil: "vera doctor venaam", "vera doctor paaka vendaam"
  new RegExp(String.raw`\s${DOCTOR_TA}(?:\s[\p{L}]+){0,2}\s(?:venaam|venam|vendam|vendaam|venda|vendaa|venaa)(?=\s)`, "gu"),
  /\s(?:வேறு|இன்னொரு)\s(?:டாக்டர்|மருத்துவர்)[\p{L}\p{M}]*(?:\s[\p{L}\p{M}]+){0,2}\s(?:வேண்டாம்|வேணாம்)(?=\s)/gu,
  // Hindi: "doosra doctor nahi chahiye", "kisi aur doctor ko nahi dikhana"
  new RegExp(String.raw`\s${DOCTOR_HI}(?:\s[\p{L}]+){0,2}\s(?:nahi|nahin|nai|mat)(?:\s(?:chahiye|chaahiye|chahie|chahta|chahti|dikhana|milna))?(?=\s)`, "gu"),
  new RegExp(String.raw`\s(?:nahi|nahin)\s(?:chahiye|chaahiye)\s${DOCTOR_HI}(?=\s)`, "gu"),
  /\s(?:दूसरे|दूसरा|दूसरी|किसी और|कोई और)\s(?:डॉक्टर|डाक्टर)(?:\s[\p{L}\p{M}]+){0,2}\s(?:नहीं|मत)(?:\s(?:चाहिए|चाहिये))?(?=\s)/gu,
];

// The message without any "NO another doctor" phrase (spaces keep word edges).
function withoutNotAnotherDoctor(text: string): string {
  return NOT_ANOTHER_DOCTOR.reduce((t, phrase) => t.replace(phrase, " "), text);
}

// Words for "tomorrow" / "day after tomorrow".
const TOMORROW_WORDS = ["tomorrow", "tmrw", "tmr", "naalai", "naalaikku", "nalaikku", "kal", "कल"];
const DAY_AFTER_WORDS = ["day after tomorrow", "parso", "parson", "naalai marunaal"];

// Weekday names → 0 = Sunday … 6 = Saturday (shared with the AI: see dayWords.ts).
const WEEKDAY_WORDS: [string[], number][] = WEEKDAYS.map((d) => [
  [...d.english, ...d.tamil, ...d.hindi],
  d.weekday,
]);

const TIME_OF_DAY_WORDS: [string[], TimeOfDay][] = [
  [["morning", "subah", "kaalai", "kaalaila", "kaalaiyil", "kalaiyil", "காலை", "सुबह"], "morning"],
  [
    ["afternoon", "noon", "dopahar", "dopehar", "madhiyam", "mathiyam", "மதியம்", "दोपहर"],
    "afternoon",
  ],
  [["evening", "shaam", "sham", "maalai", "saayangaalam", "மாலை", "शाम"], "evening"],
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// ---------- Helpers ----------

// Lower-case, expand contractions (so "I'll" never becomes "ill"), drop
// punctuation, and pad with spaces so whole words can be matched.
function normalise(message: string): string {
  let t = message.toLowerCase().replace(/[’‘`]/g, "'");
  const contractions: Record<string, string> = {
    "i'll": "i will",
    "i'm": "i am",
    "can't": "cannot",
    "won't": "will not",
    "don't": "do not",
    "didn't": "did not",
    "doesn't": "does not",
    "isn't": "is not",
    "it's": "it is",
    "i've": "i have",
    "i'd": "i would",
    "that's": "that is",
    "let's": "let us",
  };
  for (const [short, long] of Object.entries(contractions)) t = t.replaceAll(short, long);
  t = t
    .replace(/[^\p{L}\p{M}\p{N}:\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ` ${t} `;
}

// Does the (normalised) text contain this word or phrase as whole words?
function hasWord(text: string, word: string): boolean {
  const prefix = word.endsWith("*");
  const escaped = (prefix ? word.slice(0, -1) : word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\s${escaped}${prefix ? "[\\p{L}\\p{M}]*" : ""}(?=\\s)`, "u").test(text);
}
const hasAny = (text: string, words: string[]) => words.some((w) => hasWord(text, w));

// "4" → "16:00"; "9" → "09:00"; "4:30 pm" → "16:30". Clinic hours are 9–5, so
// a bare 1–5 means afternoon and 9–11 means morning. A bare 6–8 is outside
// clinic hours either way: "after 6" is read as 6 PM, "before 8" as 8 AM.
function toClock(
  hourText: string,
  minuteText?: string,
  ampm?: string,
  direction: "after" | "before" = "after",
): string | undefined {
  let hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isInteger(hour) || hour < 1 || hour > 12 || minute > 59) return undefined;
  if (ampm === "pm" && hour < 12) hour += 12;
  else if (ampm === "am" && hour === 12) hour = 0;
  else if (!ampm && hour >= 1 && hour <= 5) hour += 12;
  else if (!ampm && hour >= 6 && hour <= 8 && direction === "after") hour += 12;
  return fromMinutes(hour * 60 + minute);
}

// The dayOffset (1 … DAYS_TO_SEARCH) of the next given weekday (0 = Sunday).
function nextWeekday(weekday: number): number | undefined {
  for (let d = 1; d <= DAYS_TO_SEARCH; d++) {
    if (dateForDayOffset(d).getUTCDay() === weekday) return d;
  }
  return undefined;
}

// The dayOffset (0 … DAYS_TO_SEARCH) of a day of the month, e.g. 30 → 3.
function dayOfMonth(date: number): number | undefined {
  for (let d = 0; d <= DAYS_TO_SEARCH; d++) {
    if (dateForDayOffset(d).getUTCDate() === date) return d;
  }
  return undefined;
}

// The days (1 … 7) of every weekday the patient named, e.g. "guruvar" → the
// next Thursday. Used by the AI's day check (dayGuard.ts).
export function namedWeekdayOffsets(message: string): number[] {
  const t = withoutHarmlessPhrases(normalise(message));
  return WEEKDAY_WORDS.filter(([words]) => hasAny(t, words))
    .map(([, weekday]) => nextWeekday(weekday))
    .filter((d): d is number => d !== undefined);
}

// Pull out day and time preferences from the message.
function readPreferences(t: string): Preferences {
  const prefs: Preferences = {};

  // Day
  if (hasAny(t, DAY_AFTER_WORDS)) prefs.dayOffset = 2;
  else if (hasAny(t, TOMORROW_WORDS)) prefs.dayOffset = 1;
  for (const [words, weekday] of WEEKDAY_WORDS) {
    if (hasAny(t, words)) prefs.dayOffset = nextWeekday(weekday) ?? -1; // -1 = not within the next week
  }
  const dated =
    t.match(/\s(\d{1,2})(?:st|nd|rd|th)\s/) ??
    t.match(new RegExp(`\\s(\\d{1,2})\\s(?:${MONTHS.join("|")})[a-z]*\\s`)) ??
    t.match(new RegExp(`\\s(?:${MONTHS.join("|")})[a-z]*\\s(\\d{1,2})\\s`)) ??
    t.match(/\son the (\d{1,2})\s/);
  if (dated) prefs.dayOffset = dayOfMonth(Number(dated[1])) ?? -1;

  // Time of day
  for (const [words, timeOfDay] of TIME_OF_DAY_WORDS) {
    if (hasAny(t, words)) prefs.timeOfDay = timeOfDay;
  }

  // After / before a time — English, Hindi ("4 baje ke baad"), Tamil ("4 mani mela")
  const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s?(am|pm)?`;
  const after =
    t.match(new RegExp(String.raw`\s(?:after|past|from|later than)\s${TIME}`)) ??
    t.match(new RegExp(String.raw`\s${TIME}\s(?:baje\s)?(?:ke baad|ke bad|baad)\s`)) ??
    t.match(
      new RegExp(
        String.raw`\s${TIME}\s(?:mani(?:kku)?\s)?(?:mela|melae|apram|appuram|piragu|pirahu)\s`,
      ),
    );
  if (after) prefs.after = toClock(after[1], after[2], after[3]);
  const before =
    t.match(new RegExp(String.raw`\s(?:before|by|until|till|earlier than)\s${TIME}`)) ??
    t.match(new RegExp(String.raw`\s${TIME}\s(?:baje\s)?(?:se pehle|se pahle)\s`)) ??
    t.match(new RegExp(String.raw`\s${TIME}\s(?:mani(?:kku)?\s)?(?:munnadi|munnaadi|munnaal)\s`));
  if (before) prefs.before = toClock(before[1], before[2], before[3], "before");
  // A plain "at 4pm" / "4:30" counts as "from then on"
  if (!prefs.after && !prefs.before) {
    const at =
      t.match(new RegExp(String.raw`\sat\s${TIME}`)) ??
      t.match(/\s(\d{1,2}):(\d{2})\s?(am|pm)?\s/) ??
      t.match(/\s(\d{1,2})()\s?(am|pm)\s/);
    if (at) prefs.after = toClock(at[1], at[2] || undefined, at[3]);
  }
  return prefs;
}

// Did the patient pick one of the offers read out to them?
function pickedOffer(
  t: string,
  prefs: Preferences,
  context: UnderstandingContext,
): number | undefined {
  const { offers } = context;
  if (offers.length === 0) return undefined;

  // A letter on its own: "B", "option b", "b please", "c is fine"
  const letter = t.match(/^\s(?:option |choice )?([a-e])(?: please| pls| is fine| ok| one)?\s$/);
  if (letter) {
    const i = "abcde".indexOf(letter[1]);
    return i < offers.length ? i : undefined;
  }
  // "first one", "the second", "pehla", "rendavadhu"
  const ordinals: [string[], number][] = [
    [["first", "1st", "pehla", "pehli", "pahla", "mudhal", "muthal", "modhal"], 0],
    [
      ["second", "2nd", "doosra", "dusra", "doosri", "rendavadhu", "irandavadhu", "irandaavadhu"],
      1,
    ],
    [["third", "3rd", "teesra", "tisra", "teesri", "moonavadhu", "munravadhu"], 2],
  ];
  for (const [words, i] of ordinals) {
    if (hasAny(t, words) && i < offers.length) return i;
  }
  // Named the day (and maybe the time) of exactly one offer
  const matches = offers
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => prefs.dayOffset === undefined || o.dayOffset === prefs.dayOffset)
    .filter(({ o }) => !prefs.after || o.startTime === prefs.after);
  const saidSomething = prefs.dayOffset !== undefined || prefs.after !== undefined;
  if (saidSomething && !prefs.before && !prefs.timeOfDay && matches.length === 1) {
    return matches[0].i;
  }
  return undefined;
}

// ---------- The engine ----------

// Is this message about health in any way? (Also used as a safety net in
// front of the AI engine.)
export function mentionsHealth(message: string): boolean {
  return hasAny(withoutHarmlessPhrases(normalise(message)), HEALTH_WORDS);
}

export const understandWithRules: Understander = async (message, context) => {
  // Harmless phrases are skipped for EVERYTHING, not just the health check —
  // otherwise "tired of waiting" would be read as "I'll wait".
  const t = withoutHarmlessPhrases(normalise(message));
  const prefs = readPreferences(t);
  const result = (intent: Understanding["intent"], extra: Partial<Understanding> = {}) => ({
    intent,
    preferences: prefs,
    ...extra,
  });

  // 1. Health — always first, on the WHOLE message.
  if (hasAny(t, HEALTH_WORDS)) {
    return result("health_concern", { preferences: {} });
  }

  // Everything else is read without "NO another doctor" phrases (see above).
  // A message without one is unchanged.
  const r = withoutNotAnotherDoctor(t);
  const rPrefs = r === t ? prefs : readPreferences(r);
  const rResult = (intent: Understanding["intent"], extra: Partial<Understanding> = {}) => ({
    intent,
    preferences: rPrefs,
    ...extra,
  });

  // Keypad-style replies: "1", "2", "3", "4", "5"
  const keypad = r.trim();
  if (keypad === "1") return rResult("later_today");
  if (keypad === "2") return rResult("another_day");
  if (keypad === "3") return rResult("cancel");
  if (keypad === "4") return rResult("talk_to_person");
  if (keypad === "5") return rResult("another_doctor");

  // 2–3. Talk to a person, cancel
  if (hasAny(r, TALK_WORDS)) return rResult("talk_to_person");
  if (hasAny(r, CANCEL_WORDS)) return rResult("cancel");

  // 3b. Another doctor today
  if (hasAny(r, ANOTHER_DOCTOR_WORDS)) return rResult("another_doctor");

  // 4. One of the offers
  const offerIndex = pickedOffer(r, rPrefs, context);
  if (offerIndex !== undefined) return rResult("choose_offer", { offerIndex });

  // 5. Another day — a day other than today was named, or "another day"
  const namedOtherDay = rPrefs.dayOffset !== undefined && rPrefs.dayOffset !== 0;
  if (namedOtherDay || hasAny(r, ANOTHER_DAY_WORDS)) return rResult("another_day");

  // 6. Later today
  if (rPrefs.dayOffset === 0 || hasAny(r, LATER_TODAY_WORDS)) return rResult("later_today");

  // 7. Only a time preference ("after 4", "evening") — don't guess the day:
  //    DocDelay will ask "today, or another day?"
  if (rPrefs.timeOfDay || rPrefs.after || rPrefs.before) return rResult("time_without_day");

  // 8. Nothing matched
  return result("unclear", { preferences: {} });
};
