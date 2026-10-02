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
//   h.12.1.n.4.n.1600.n.<text>.mg3k2g22   chat: appt-012, what the patient typed
//                              (<text>, base64) and what it was understood to mean
//                              (intent #1, no offer, day 4, any time, after 16:00)
//   w.12.1.n.4.n.1600.n.<text>.mg3k2g22   WhatsApp message for appt-012 (same parts as "h")
//   v.12.…                     the same, sent as a VOICE NOTE (<text> = what was heard)
//   p.12.…                     the same, a PHOTO (never read, so <text> is empty)
//   f.12.mg3k2h33              staff marked appt-012's URGENT flag a false alarm
//   b.12.3.1015.mg3k2i44       bookSlot tool: book appt-012 on day 3 at 10:15
//   a.12.b3-1615.<text>.<reply>.3-1600~4-1615.mg3k2j55
//                              AI chat turn for appt-012: its outcome (here: book
//                              day 3 at 16:15), the patient's text and the AI's
//                              reply (both compressed), and the slots it offered
// Steps are joined with "_". Times are milliseconds since 1970, in base 36.
//
// Chat messages are saved together with what they were understood to mean,
// so replaying the demo never has to run the "understanding" step again
// (with the AI version, that means no repeated — and paid — AI calls).

import { cookies } from "next/headers";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import startingData from "./mockData.json";
import { CALL_RESULTS, UNAVAILABILITY_REASONS } from "./types";
import type { CallResult, SlotOffer, UnavailabilityReason, WhatsAppMedia } from "./types";
import { isValidTime } from "@/lib/time";
import { INTENTS, type Understanding } from "@/lib/understanding/types";
import type { TimeOfDay } from "@/lib/reschedulingRules";

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
  | { kind: "send"; at: number }
  | {
      kind: "chat";
      at: number;
      appointmentId: string;
      text: string; // what the patient typed (at most MAX_CHAT_TEXT characters)
      understanding: Understanding; // what it was understood to mean
    }
  | {
      kind: "whatsapp"; // a WhatsApp message from the patient (saved like a chat message)
      at: number;
      appointmentId: string;
      text: string;
      understanding: Understanding;
      media?: WhatsAppMedia; // a voice note or a photo; left out = typed
    }
  | { kind: "falseAlarm"; at: number; appointmentId: string }
  | { kind: "book"; at: number; appointmentId: string; dayOffset: number; startTime: string }
  | {
      kind: "ai";
      at: number;
      appointmentId: string;
      text: string; // what the patient typed
      reply: string; // what the AI replied (checked before saving)
      offers: SlotOffer[]; // slots the AI offered in this turn (from checkFreeSlots)
      action?: AiAction; // at most one outcome, already checked by the hms rules
      unclear?: boolean; // the AI couldn't understand this message (counted by the hms module)
    };

// The one outcome an AI chat turn may record. The hms module applies it with
// the same rules as everywhere else.
export type AiAction =
  | { kind: "book"; dayOffset: number; startTime: string; doctorId?: string } // via bookSlot (doctorId: another doctor today)
  | { kind: "wait" } // plain "later today" (the push rules)
  | { kind: "cancel" }
  | { kind: "staff"; reason: StaffReason }
  | { kind: "urgent" }; // health concern → URGENT staff call

export const STAFF_REASONS = [
  "asked_for_person",
  "could_not_understand",
  "no_suitable_time",
] as const;
export type StaffReason = (typeof STAFF_REASONS)[number];

export const MAX_AI_REPLY = 700; // longest AI reply kept (characters)

export const MAX_CHAT_TEXT = 200; // longest chat message kept

const COOKIE_NAME = "docdelay-demo";
// Browsers allow about 4,000 characters per cookie, so the steps are split
// over up to MAX_COOKIES cookies ("docdelay-demo", "docdelay-demo-2", …).
// That's roughly 550 steps — a full demo run uses about 40, or ~100 in chat.
const CHUNK_LENGTH = 3800;
const MAX_COOKIES = 3;
const cookieName = (i: number) => (i === 0 ? COOKIE_NAME : `${COOKIE_NAME}-${i + 1}`);

const doctorIds = startingData.doctors.map((d) => d.id);

// ---------- Turning steps into text and back ----------

const hhmm = (time: string) => time.replace(":", ""); // "09:00" → "0900"
const unHhmm = (code: string) => `${code.slice(0, 2)}:${code.slice(2)}`; // "0900" → "09:00"
const apptNumber = (id: string) => Number(id.replace("appt-", "")); // "appt-012" → 12
const apptId = (n: number) => `appt-${String(n).padStart(3, "0")}`; // 12 → "appt-012"
const TIMES_OF_DAY: TimeOfDay[] = ["morning", "afternoon", "evening"];
// The first letter of a saved WhatsApp message: typed, voice note or photo.
const WHATSAPP_CODES = { typed: "w", voice: "v", photo: "p" } as const;
// Chat text → cookie-safe letters (base64, with "_" swapped for "*" because
// "_" separates the steps) and back.
const packText = (text: string) =>
  Buffer.from(text.slice(0, MAX_CHAT_TEXT), "utf8").toString("base64url").replace(/_/g, "*");
const unpackText = (code: string) =>
  Buffer.from(code.replace(/\*/g, "_"), "base64url").toString("utf8").slice(0, MAX_CHAT_TEXT);
const orN = (value: string | number | undefined) => (value === undefined ? "n" : value);
// Longer texts (AI replies, often in Tamil or Hindi) are compressed first.
const packLong = (text: string, max: number) =>
  deflateRawSync(Buffer.from(text.slice(0, max), "utf8"))
    .toString("base64url")
    .replace(/_/g, "*");
const unpackLong = (code: string, max: number) =>
  inflateRawSync(Buffer.from(code.replace(/\*/g, "_"), "base64url"))
    .toString("utf8")
    .slice(0, max);
// Offers ↔ "3-1015~4-1400"
// A slot with ANOTHER doctor ("another doctor today") gets the doctor's number
// as a third part: "0-0930-3". Older saved demos (two parts) still read the same.
const doctorPart = (doctorId?: string) => (doctorId ? `-${doctorIds.indexOf(doctorId)}` : "");
const unpackDoctor = (code: string | undefined): string | undefined | null =>
  code === undefined ? undefined : (doctorIds[Number(code)] ?? null);
const packOffers = (offers: SlotOffer[]) =>
  offers.length
    ? offers.map((o) => `${o.dayOffset}-${hhmm(o.startTime)}${doctorPart(o.doctorId)}`).join("~")
    : "n";
const unpackOffers = (code: string): SlotOffer[] | null => {
  if (code === "n") return [];
  const offers = code.split("~").map((o) => {
    const [day, time, doctor] = o.split("-");
    const doctorId = unpackDoctor(doctor);
    return {
      dayOffset: Number(day),
      startTime: unHhmm(time ?? ""),
      ...(doctorId !== undefined ? { doctorId } : {}),
    };
  });
  return offers.every(
    (o) => Number.isInteger(o.dayOffset) && isValidTime(o.startTime) && o.doctorId !== null,
  )
    ? (offers as SlotOffer[])
    : null;
};
// AI outcome ↔ "n" | "b3-1615" | "b0-0930-3" (with another doctor) | "w" | "c" | "s0" | "u"
// ("x" = no outcome, not understood)
const packAction = (a?: AiAction) =>
  !a
    ? "n"
    : a.kind === "book"
      ? `b${a.dayOffset}-${hhmm(a.startTime)}${doctorPart(a.doctorId)}`
      : a.kind === "staff"
        ? `s${STAFF_REASONS.indexOf(a.reason)}`
        : { wait: "w", cancel: "c", urgent: "u" }[a.kind];
const unpackAction = (code: string): AiAction | undefined | null => {
  if (code === "n") return undefined;
  if (code === "w") return { kind: "wait" };
  if (code === "c") return { kind: "cancel" };
  if (code === "u") return { kind: "urgent" };
  if (code.startsWith("s")) {
    const reason = STAFF_REASONS[Number(code.slice(1))];
    return reason ? { kind: "staff", reason } : null;
  }
  if (code.startsWith("b")) {
    const [day, time, doctor] = code.slice(1).split("-");
    const startTime = unHhmm(time ?? "");
    const doctorId = unpackDoctor(doctor);
    if (!Number.isInteger(Number(day)) || !isValidTime(startTime) || doctorId === null) return null;
    return {
      kind: "book",
      dayOffset: Number(day),
      startTime,
      ...(doctorId !== undefined ? { doctorId } : {}),
    };
  }
  return null;
};

// (Exported for the tests only.)
export function encodeStep(step: DemoStep): string {
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
    case "chat":
    case "whatsapp": {
      const u = step.understanding;
      const p = u.preferences;
      return [
        step.kind === "chat" ? "h" : WHATSAPP_CODES[step.media ?? "typed"],
        apptNumber(step.appointmentId),
        INTENTS.indexOf(u.intent),
        orN(u.offerIndex),
        orN(p.dayOffset),
        p.timeOfDay ? TIMES_OF_DAY.indexOf(p.timeOfDay) : "n",
        p.after ? hhmm(p.after) : "n",
        p.before ? hhmm(p.before) : "n",
        packText(step.text),
        at,
      ].join(".");
    }
    case "falseAlarm":
      return ["f", apptNumber(step.appointmentId), at].join(".");
    case "book":
      return ["b", apptNumber(step.appointmentId), step.dayOffset, hhmm(step.startTime), at].join(
        ".",
      );
    case "ai":
      return [
        "a",
        apptNumber(step.appointmentId),
        !step.action && step.unclear ? "x" : packAction(step.action),
        packLong(step.text, MAX_CHAT_TEXT),
        packLong(step.reply, MAX_AI_REPLY),
        packOffers(step.offers),
        at,
      ].join(".");
  }
}

// Returns null for anything that doesn't look right (the cookie comes from
// the visitor's browser, so we never trust it blindly).
export function decodeStep(code: string): DemoStep | null {
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
  if (["h", "w", "v", "p"].includes(kind) && parts.length === 9) {
    const [appt, intentIndex, offer, day, tod, after, before, text] = parts;
    const intent = INTENTS[Number(intentIndex)];
    const num = (v: string) => (v === "n" ? undefined : Number(v));
    const time = (v: string) => (v === "n" ? undefined : unHhmm(v));
    const understanding: Understanding = {
      intent,
      offerIndex: num(offer),
      preferences: {
        dayOffset: num(day),
        timeOfDay: tod === "n" ? undefined : TIMES_OF_DAY[Number(tod)],
        after: time(after),
        before: time(before),
      },
    };
    const p = understanding.preferences;
    const badNumber = [num(appt), understanding.offerIndex, p.dayOffset].some(
      (n) => n !== undefined && !Number.isInteger(n),
    );
    const badTime = [p.after, p.before].some((t) => t !== undefined && !isValidTime(t));
    if (!intent || badNumber || badTime || (tod !== "n" && !p.timeOfDay)) return null;
    const step = { at, appointmentId: apptId(Number(appt)), text: unpackText(text), understanding };
    if (kind === "h") return { kind: "chat", ...step };
    if (kind === "v") return { kind: "whatsapp", ...step, media: "voice" };
    if (kind === "p") return { kind: "whatsapp", ...step, media: "photo" };
    return { kind: "whatsapp", ...step };
  }
  if (kind === "f" && parts.length === 2 && Number.isInteger(Number(parts[0]))) {
    return { kind: "falseAlarm", at, appointmentId: apptId(Number(parts[0])) };
  }
  if (kind === "b" && parts.length === 4) {
    const startTime = unHhmm(parts[2]);
    if (!Number.isInteger(Number(parts[0])) || !Number.isInteger(Number(parts[1]))) return null;
    if (!isValidTime(startTime)) return null;
    return {
      kind: "book",
      at,
      appointmentId: apptId(Number(parts[0])),
      dayOffset: Number(parts[1]),
      startTime,
    };
  }
  if (kind === "a" && parts.length === 6) {
    const [appt, action, text, reply, offers] = parts;
    if (!Number.isInteger(Number(appt))) return null;
    const unclear = action === "x"; // no outcome; the message couldn't be understood
    const parsedAction = unclear ? undefined : unpackAction(action);
    const parsedOffers = unpackOffers(offers);
    if (parsedAction === null || parsedOffers === null) return null;
    try {
      return {
        kind: "ai",
        at,
        appointmentId: apptId(Number(appt)),
        text: unpackLong(text, MAX_CHAT_TEXT),
        reply: unpackLong(reply, MAX_AI_REPLY),
        offers: parsedOffers,
        action: parsedAction,
        unclear,
      };
    } catch {
      return null; // not valid compressed text
    }
  }
  return null;
}

// ---------- Reading and writing the cookie(s) ----------

// The whole saved text, joined back together from its cookies.
async function readValue(): Promise<string> {
  const store = await cookies();
  let value = "";
  for (let i = 0; i < MAX_COOKIES; i++) value += store.get(cookieName(i))?.value ?? "";
  return value;
}

// Everything this visitor has done so far, oldest first.
export async function readSteps(): Promise<DemoStep[]> {
  const value = await readValue();
  if (!value) return [];
  return value
    .split("_")
    .map(decodeStep)
    .filter((s): s is DemoStep => s !== null);
}

// Save the visitor's steps. Returns false (and saves nothing) if they would
// get too big — the visitor then needs to press "Reset demo".
// Only works inside a Server Action (that's where Next.js allows setting cookies).
export async function writeSteps(steps: DemoStep[]): Promise<boolean> {
  const value = steps.map(encodeStep).join("_");
  if (value.length > CHUNK_LENGTH * MAX_COOKIES) return false;
  const store = await cookies();
  for (let i = 0; i < MAX_COOKIES; i++) {
    const chunk = value.slice(i * CHUNK_LENGTH, (i + 1) * CHUNK_LENGTH);
    if (chunk) {
      store.set(cookieName(i), chunk, {
        httpOnly: true, // page scripts can't read or change it
        sameSite: "lax",
        path: "/",
        // No maxAge: the demo is forgotten when the browser is closed.
      });
    } else if (store.get(cookieName(i))) {
      store.delete(cookieName(i));
    }
  }
  return true;
}

// Is the visitor's demo history close to the limit?
export async function isNearlyFull(): Promise<boolean> {
  return (await readValue()).length > CHUNK_LENGTH * MAX_COOKIES - 400;
}

// Forget everything this visitor did ("Reset demo").
export async function clearSteps(): Promise<void> {
  const store = await cookies();
  for (let i = 0; i < MAX_COOKIES; i++) store.delete(cookieName(i));
}
