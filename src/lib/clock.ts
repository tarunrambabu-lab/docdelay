// THE CLOCK — the only place the app asks "what time is it?" or "what's the
// date today?". Everything else gets the time and date from here.
// (A test checks that no other file reads the computer's clock.)
//
// CLOCK_MODE (the one setting):
//   "demo" = the time is FIXED at DEMO_TIME (9:00 AM) and never ticks. The
//            date is today's real date in India. Used now, so the demo works
//            the same whenever someone visits.
//   "real" = the real time in India (for later).
//
// ⚠️ Before switching to "real": the booking rules (lib/reschedulingRules.ts)
// don't look at the time. With a fixed 9:00 AM that's fine — 9:00 is the
// first slot, so nothing can be in the past. With the real time, a patient
// could be offered (and booked into) a slot that has already gone, e.g. 9:30
// at 11 AM. The rules need a "not before now" check first (see BACKLOG.md).
//
// Stored stamps (when a button was pressed, when a text was sent) always use
// the REAL time — see realTimestamp. They make each step unique and keep
// steps in order. Only how they're SHOWN follows the mode (see formatClock
// in time.ts).

export type ClockMode = "demo" | "real";

export const CLOCK_MODE: ClockMode = "demo";

// The fixed time in demo mode ("HH:MM", 24-hour).
export const DEMO_TIME = "09:00";

// The hospital's time zone. "Today" always means today in the hospital,
// even when the server runs somewhere else (e.g. Vercel servers use UTC).
export const HOSPITAL_TIME_ZONE = "Asia/Kolkata";

// The time at the hospital now, "HH:MM" (24-hour): always DEMO_TIME in demo mode.
export function hospitalTimeNow(mode: ClockMode = CLOCK_MODE): string {
  if (mode === "demo") return DEMO_TIME;
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: HOSPITAL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

// Today's date at the hospital, "YYYY-MM-DD" ("en-CA" gives that order).
// The real date in India in BOTH modes.
export function hospitalToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: HOSPITAL_TIME_ZONE });
}

// The real moment, in milliseconds since 1970 — for STORED stamps only.
export function realTimestamp(): number {
  return Date.now();
}
