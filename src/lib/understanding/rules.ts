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
//   2. talk to a person
//   3. cancel
//   4. choose one of the offers read out (A/B/C, or its day/time)
//   5. another day (a day word, a date, "another day", …)
//   6. later today ("wait", "later", "today", …)
//   7. a time preference with no day ("after 4") → ask "today, or another day?"
//   8. otherwise: unclear

import type { Understander, Preferences, Understanding, UnderstandingContext } from "./types";
import type { TimeOfDay } from "@/lib/reschedulingRules";
import { DAYS_TO_SEARCH } from "@/lib/reschedulingRules";
import { dateForDayOffset, fromMinutes } from "@/lib/time";

// ---------- Word lists ----------
// A trailing "*" means "any word starting with this" (e.g. "breath*" matches
// "breathless", "breathing").

// Anything health-related. False alarms are fine (staff can clear them);
// missing a real concern is not.
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
  "dizz*",
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
  // Tamil (romanised)
  "vali",
  "valikudhu",
  "valikuthu",
  "valikkudhu",
  "valikkuthu",
  "nenju",
  "nenju vali",
  "mayakkam",
  "mayangi*",
  "kaichal",
  "kaaichal",
  "juram",
  "udambu sari illa",
  "udambu sariyilla",
  "udambu seriyilla",
  "moochu",
  "mochu",
  "ratham",
  "rattham",
  "vaanthi",
  "vandhi",
  "vanthi",
  "thalai suthuthu",
  "thala suthudhu",
  "thalai suthudhu",
  // Hindi (romanised)
  "dard",
  "seene",
  "seena",
  "sine mein",
  "saans",
  "sans",
  "chakkar",
  "behosh",
  "bukhar",
  "bukhaar",
  "ulti",
  "khoon",
  "tabiyat",
  "tabiyat theek nahi",
  "tabiyat kharab",
  "bimar",
  "beemar",
  "bimaar",
  "ghabrahat",
  "kamzori",
  "dawai",
  "dawa",
  "dava",
  // Tamil script
  "வலி",
  "நெஞ்சு",
  "மயக்கம்",
  "காய்ச்சல்",
  "மூச்சு",
  "ரத்தம்",
  "வாந்தி",
  "உடம்பு",
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

// Words for "tomorrow" / "day after tomorrow".
const TOMORROW_WORDS = ["tomorrow", "tmrw", "tmr", "naalai", "naalaikku", "nalaikku", "kal", "कल"];
const DAY_AFTER_WORDS = ["day after tomorrow", "parso", "parson", "naalai marunaal"];

// Weekday names → 0 = Sunday … 6 = Saturday.
const WEEKDAY_WORDS: [string[], number][] = [
  [["sunday", "sun", "nyayiru", "gnayiru", "ravivar", "itvar"], 0],
  [["monday", "mon", "thingal", "thinkal", "somvar"], 1],
  [["tuesday", "tue", "tues", "sevvai", "mangalvar"], 2],
  [["wednesday", "wed", "budhan", "puthan", "budhvar", "budhwar"], 3],
  [
    [
      "thursday",
      "thu",
      "thur",
      "thurs",
      "vyazhan",
      "viyazhan",
      "guruvar",
      "veervar",
      "brihaspativar",
    ],
    4,
  ],
  [["friday", "fri", "velli", "shukravar"], 5],
  [["saturday", "sat", "sani", "shanivar"], 6],
];

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
  return hasAny(normalise(message), HEALTH_WORDS);
}

export const understandWithRules: Understander = async (message, context) => {
  const t = normalise(message);
  const prefs = readPreferences(t);
  const result = (intent: Understanding["intent"], extra: Partial<Understanding> = {}) => ({
    intent,
    preferences: prefs,
    ...extra,
  });

  // 1. Health — always first.
  if (hasAny(t, HEALTH_WORDS)) return result("health_concern", { preferences: {} });

  // Keypad-style replies: "1", "2", "3", "4"
  const keypad = t.trim();
  if (keypad === "1") return result("later_today");
  if (keypad === "2") return result("another_day");
  if (keypad === "3") return result("cancel");
  if (keypad === "4") return result("talk_to_person");

  // 2–3. Talk to a person, cancel
  if (hasAny(t, TALK_WORDS)) return result("talk_to_person");
  if (hasAny(t, CANCEL_WORDS)) return result("cancel");

  // 4. One of the offers
  const offerIndex = pickedOffer(t, prefs, context);
  if (offerIndex !== undefined) return result("choose_offer", { offerIndex });

  // 5. Another day — a day other than today was named, or "another day"
  const namedOtherDay = prefs.dayOffset !== undefined && prefs.dayOffset !== 0;
  if (namedOtherDay || hasAny(t, ANOTHER_DAY_WORDS)) return result("another_day");

  // 6. Later today
  if (prefs.dayOffset === 0 || hasAny(t, LATER_TODAY_WORDS)) return result("later_today");

  // 7. Only a time preference ("after 4", "evening") — don't guess the day:
  //    DocDelay will ask "today, or another day?"
  if (prefs.timeOfDay || prefs.after || prefs.before) return result("time_without_day");

  // 8. Nothing matched
  return result("unclear", { preferences: {} });
};
