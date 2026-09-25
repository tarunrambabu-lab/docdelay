// Small helpers for "HH:MM" (24-hour) time strings and for days.

import type { Language } from "@/hms/types";

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

// The real calendar date for a dayOffset (using this computer's clock).
export function dateForDayOffset(dayOffset: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// 2 → "Mon 28 Sep" (English), "செப்டம்பர் 28, திங்கள்" (Tamil), "सोमवार, 28 सितंबर" (Hindi)
export function formatDate(dayOffset: number, language: Language = "English"): string {
  const date = dateForDayOffset(dayOffset);
  if (language === "English") {
    return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  }
  const locale = language === "Tamil" ? "ta-IN" : "hi-IN";
  return date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
}

// (0, "10:00") → "Today 10:00 AM";  (2, "10:15") → "Mon 28 Sep, 10:15 AM"
export function formatWhen(dayOffset: number, time: string): string {
  return dayOffset === 0
    ? `Today ${formatTime(time)}`
    : `${formatDate(dayOffset)}, ${formatTime(time)}`;
}
