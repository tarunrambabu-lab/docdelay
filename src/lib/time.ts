// Small helpers for "HH:MM" (24-hour) time strings and for days.

import type { Language } from "@/hms/types";
import {
  CLOCK_MODE,
  DEMO_TIME,
  HOSPITAL_TIME_ZONE,
  hospitalTimeNow,
  hospitalToday,
  type ClockMode,
} from "@/lib/clock";

// (The time zone lives in clock.ts; re-exported here for the screens.)
export { HOSPITAL_TIME_ZONE };

// "13:45" → 825 (minutes since midnight)
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// 825 → "13:45"
export function fromMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// "13:45" → "1:45 PM"
export function formatTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hours12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

// Is this a real "HH:MM" time between 00:00 and 23:59?
export function isValidTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

// ---------- Days ----------
// Appointments store a "dayOffset": 0 = today, 1 = tomorrow, and so on.

// The calendar date for a dayOffset, as a Date at midnight UTC.
// Read it with getUTCDay() / getUTCDate() / getUTCMonth(), or format it with
// timeZone: "UTC" — never with the local-time methods.
export function dateForDayOffset(dayOffset: number): Date {
  // Today's date in the hospital, e.g. "2026-09-26" (from the clock).
  const [year, month, day] = hospitalToday().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + dayOffset));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// 2 → "Mon 28 Sep" (English), "செப்டம்பர் 28, திங்கள்" (Tamil), "सोमवार, 28 सितंबर" (Hindi)
export function formatDate(dayOffset: number, language: Language = "English"): string {
  const date = dateForDayOffset(dayOffset);
  if (language === "English") {
    return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  }
  const locale = language === "Tamil" ? "ta-IN" : "hi-IN";
  return date.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

// (0, "10:00") → "Today 10:00 AM";  (2, "10:15") → "Mon 28 Sep, 10:15 AM"
export function formatWhen(dayOffset: number, time: string): string {
  return dayOffset === 0
    ? `Today ${formatTime(time)}`
    : `${formatDate(dayOffset)}, ${formatTime(time)}`;
}

// A stored stamp, as shown on screen — for logs and "Sent" times.
//   Demo clock: always the demo time ("9:00 AM"), to match "Demo time: 9:00 AM".
//   Real clock: "2026-09-27T05:10:00.000Z" → "10:40 am" (hospital time), with
//   seconds if asked.
export function formatClock(
  isoDateTime: string,
  options: { seconds?: boolean } = {},
  mode: ClockMode = CLOCK_MODE,
): string {
  if (mode === "demo") return formatTime(DEMO_TIME);
  return new Date(isoDateTime).toLocaleTimeString("en-IN", {
    timeZone: HOSPITAL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" } : {}),
  });
}

// The clock line on the dashboard: "Demo time: 9:00 AM" (demo clock), or
// "Time now: 3:47 PM (India)" (real clock).
export function clockLabel(mode: ClockMode = CLOCK_MODE): string {
  const time = formatTime(hospitalTimeNow(mode));
  return mode === "demo" ? `Demo time: ${time}` : `Time now: ${time} (India)`;
}

// A time as shown to a PATIENT, in their language:
//   English: "4:30 PM"
//   Tamil:   "மாலை 4:30 (4:30 PM)"      Hindi: "शाम 4:30 (4:30 PM)"
// Tamil and Hindi get the local word for the time of day, plus the time with
// AM/PM in brackets. (Staff screens keep using formatTime.)
//
// ⚠️ The Tamil and Hindi time-of-day words (and where one part of the day
// ends and the next begins) must be checked by a native speaker before real use.
const TIME_OF_DAY_WORDS: Record<"Tamil" | "Hindi", [number, string][]> = {
  // [starts at hour, word] — the last one that has started wins
  Tamil: [
    [0, "இரவு"], // night
    [5, "காலை"], // morning
    [12, "மதியம்"], // afternoon
    [16, "மாலை"], // evening
    [20, "இரவு"], // night
  ],
  Hindi: [
    [0, "रात"], // night
    [5, "सुबह"], // morning
    [12, "दोपहर"], // afternoon
    [16, "शाम"], // evening
    [20, "रात"], // night
  ],
};

export function formatTimeFor(time: string, language: Language): string {
  const clock = formatTime(time); // "4:30 PM"
  if (language === "English") return clock;
  const hour = Math.floor(toMinutes(time) / 60);
  const word = TIME_OF_DAY_WORDS[language].filter(([from]) => hour >= from).at(-1)![1];
  const bare = clock.replace(/ (AM|PM)$/, ""); // "4:30"
  return `${word} ${bare} (${clock})`;
}
