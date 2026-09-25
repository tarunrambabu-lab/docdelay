// Each visitor's own demo, kept in a cookie in their browser.
//
// The cookie does NOT hold the whole hospital (that's far too big for a
// cookie). It holds a short list of what the visitor DID — "marked Dr. X
// unavailable 9–11", "patient 12 pressed 1", "picked offer B", "sent updates".
// On every page load, mockHms.ts starts from mockData.json and replays these
// steps in order to rebuild that visitor's demo. Nobody sees anyone else's clicks.
//
// Each step is written in a compact code to keep the cookie small, e.g.
//   u.0.0.0900.1100.mg3k2a1b   unavailable: doctor #0, reason #0, 09:00–11:00, at <time>
//   c.12.0.mg3k2c9d            call: appt-012 answered result #0, at <time>
//   o.12.1.mg3k2e0f            offer: appt-012 picked offer #1 (B)   ("n" = none of these)
//   s.mg3k2f11                 send all pending updates
// Steps are joined with "_". Times are milliseconds since 1970, in base 36.

import { cookies } from "next/headers";
import startingData from "./mockData.json";
import { CALL_RESULTS, UNAVAILABILITY_REASONS } from "./types";
import type { CallResult, UnavailabilityReason } from "./types";
import { isValidTime } from "@/lib/time";

// One thing the visitor did.
export type DemoStep =
  | {
      kind: "unavailable";
      at: number;
      doctorId: string;
      reason: UnavailabilityReason;
      fromTime: string;
      untilTime: string;
    }
  | { kind: "call"; at: number; appointmentId: string; result: CallResult }
  | { kind: "offer"; at: number; appointmentId: string; choice: number | null }
  | { kind: "send"; at: number };

const COOKIE_NAME = "docdelay-demo";
// Browsers allow about 4,000 characters per cookie; stay safely below that.
// That's roughly 200 steps — a full demo run uses about 40.
const MAX_COOKIE_LENGTH = 3800;

const doctorIds = startingData.doctors.map((d) => d.id);

// ---------- Turning steps into text and back ----------

const hhmm = (time: string) => time.replace(":", ""); // "09:00" → "0900"
const unHhmm = (code: string) => `${code.slice(0, 2)}:${code.slice(2)}`; // "0900" → "09:00"
const apptNumber = (id: string) => Number(id.replace("appt-", "")); // "appt-012" → 12
const apptId = (n: number) => `appt-${String(n).padStart(3, "0")}`; // 12 → "appt-012"

function encodeStep(step: DemoStep): string {
  const at = step.at.toString(36);
  switch (step.kind) {
    case "unavailable":
      return [
        "u",
        doctorIds.indexOf(step.doctorId),
        UNAVAILABILITY_REASONS.indexOf(step.reason),
        hhmm(step.fromTime),
        hhmm(step.untilTime),
        at,
      ].join(".");
    case "call":
      return ["c", apptNumber(step.appointmentId), CALL_RESULTS.indexOf(step.result), at].join(".");
    case "offer":
      return ["o", apptNumber(step.appointmentId), step.choice ?? "n", at].join(".");
    case "send":
      return ["s", at].join(".");
  }
}

// Returns null for anything that doesn't look right (the cookie comes from
// the visitor's browser, so we never trust it blindly).
function decodeStep(code: string): DemoStep | null {
  const [kind, ...parts] = code.split(".");
  const at = parseInt(parts.at(-1) ?? "", 36);
  if (!Number.isFinite(at)) return null;

  if (kind === "u" && parts.length === 5) {
    const doctorId = doctorIds[Number(parts[0])];
    const reason = UNAVAILABILITY_REASONS[Number(parts[1])];
    const fromTime = unHhmm(parts[2]);
    const untilTime = unHhmm(parts[3]);
    if (!doctorId || !reason || !isValidTime(fromTime) || !isValidTime(untilTime)) return null;
    return { kind: "unavailable", at, doctorId, reason, fromTime, untilTime };
  }
  if (kind === "c" && parts.length === 3) {
    const result = CALL_RESULTS[Number(parts[1])];
    if (!result || !Number.isInteger(Number(parts[0]))) return null;
    return { kind: "call", at, appointmentId: apptId(Number(parts[0])), result };
  }
  if (kind === "o" && parts.length === 3) {
    const choice = parts[1] === "n" ? null : Number(parts[1]);
    if ((choice !== null && !Number.isInteger(choice)) || !Number.isInteger(Number(parts[0]))) {
      return null;
    }
    return { kind: "offer", at, appointmentId: apptId(Number(parts[0])), choice };
  }
  if (kind === "s" && parts.length === 1) return { kind: "send", at };
  return null;
}

// ---------- Reading and writing the cookie ----------

// Everything this visitor has done so far, oldest first.
export async function readSteps(): Promise<DemoStep[]> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!value) return [];
  return value
    .split("_")
    .map(decodeStep)
    .filter((s): s is DemoStep => s !== null);
}

// Save the visitor's steps. Returns false (and saves nothing) if the cookie
// would get too big — the visitor then needs to press "Reset demo".
// Only works inside a Server Action (that's where Next.js allows setting cookies).
export async function writeSteps(steps: DemoStep[]): Promise<boolean> {
  const value = steps.map(encodeStep).join("_");
  if (value.length > MAX_COOKIE_LENGTH) return false;
  (await cookies()).set(COOKIE_NAME, value, {
    httpOnly: true, // page scripts can't read or change it
    sameSite: "lax",
    path: "/",
    // No maxAge: the demo is forgotten when the browser is closed.
  });
  return true;
}

// Is the visitor's demo history close to the cookie limit?
export async function isNearlyFull(): Promise<boolean> {
  const value = (await cookies()).get(COOKIE_NAME)?.value ?? "";
  return value.length > MAX_COOKIE_LENGTH - 200;
}

// Forget everything this visitor did ("Reset demo").
export async function clearSteps(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}
