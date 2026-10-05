// THE CLOCK — the only place the app asks "what time is it?" or "what's the
// date today?". Everything else gets the time and date from here.
// (A test checks that no other file reads the computer's clock.)
//
// CLOCK_MODE (the one setting):
//   "demo" = each visitor's demo has its OWN "time now". It starts at
//            DEMO_TIME (9:00 AM) and only moves when the visitor picks a later
//            time on the dashboard ("Demo time: [9:00 AM ▾]"). That time is
//            kept with the visitor's demo steps (see the hms module), so this
//            file only knows where it STARTS. The date is today's real date
//            in India.
//   "real" = the real time in India (for later).
//
// The booking rules never offer or book a time today that has already passed
// (the "not before now" check — see bookingsStartAt in lib/returnCheck.ts),
// in both modes. "real" still stays off: the dashboard doesn't refresh by
// itself yet, and the SMS fallback doesn't really wait 15 minutes (BACKLOG.md).
//
// Stored stamps (when a button was pressed, when a text was sent):
//   - the STEP's own stamp is always the REAL time (see realTimestamp). It
//     makes each step unique and keeps steps in order;
//   - what is SHOWN in logs and "Sent" lines is the hospital's time when it
//     happened: in the demo, the demo time at that moment (see demoMoment).

export type ClockMode = "demo" | "real";

export const CLOCK_MODE: ClockMode = "demo";

// The time every demo STARTS at ("HH:MM", 24-hour), and the last time the
// demo's time picker offers.
export const DEMO_TIME = "09:00";
export const DEMO_LATEST_TIME = "17:00";

// The hospital's time zone. "Today" always means today in the hospital,
// even when the server runs somewhere else (e.g. Vercel servers use UTC).
export const HOSPITAL_TIME_ZONE = "Asia/Kolkata";

// The clock's own time, "HH:MM" (24-hour). In demo mode this is where every
// demo STARTS (DEMO_TIME) — a visitor's current demo time comes from the hms
// module (getTimeNow). In real mode it's the time at the hospital right now.
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

// The hospital's time ("HH:MM") at a stored real moment — real mode only.
export function hospitalTimeAt(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-GB", {
    timeZone: HOSPITAL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

// DEMO: the moment to show in a log line or "Sent" line for something that
// happened when the demo time was `time` ("HH:MM") — today's date at the
// hospital, at that time. The seconds come from the real stamp, only to keep
// stamps different from each other. (+05:30 is HOSPITAL_TIME_ZONE's offset.)
export function demoMoment(time: string, realTimestamp = 0): string {
  const seconds = new Date(realTimestamp).toISOString().slice(17, 23); // "SS.mmm"
  return new Date(`${hospitalToday()}T${time}:${seconds}+05:30`).toISOString();
}
