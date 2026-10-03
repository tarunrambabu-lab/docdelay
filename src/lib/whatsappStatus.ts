// What the dashboard shows about WhatsApp on each patient's row (WhatsApp
// Part 3). Read-only: these helpers only look at data the screens already
// have — they never change anything.
//
//   - "WhatsApp OK": before DocDelay contacts an opted-in patient.
//   - After contact: which channel the answer came from ("Answered by call" /
//     "Answered on WhatsApp") and where WhatsApp stands now (sent, replied,
//     update sent, fell back to SMS, closed after STOP).
//   - An "Open WhatsApp" link for opted-in patients DocDelay has contacted.
//   - Photo notes: photos are never read, so staff just see that one came.

import type { AppointmentWithPatient, CallLogEntry, SmsMessage } from "@/hms/types";
import { ANSWERED_STATUSES } from "@/lib/status";

export type AnswerChannel = "Answered by call" | "Answered on WhatsApp";

export type WhatsAppState =
  | "WhatsApp sent"
  | "Replied on WhatsApp"
  // "sent", not "delivered": nothing tells DocDelay the patient has read it.
  | "Update sent (WhatsApp)"
  | "WhatsApp not delivered → SMS"
  | "WhatsApp closed (STOP)";

export interface WhatsAppRowInfo {
  okLabel: boolean; // show "WhatsApp OK"
  answeredBy?: AnswerChannel;
  state?: WhatsAppState;
  photos: number; // photos the patient sent (never read)
  link: boolean; // show "Open WhatsApp"
}

// Has DocDelay contacted this patient? Affected patients: yes (the first
// message goes out as soon as the doctor is marked unavailable). Pushed
// patients: once their heads-up was sent.
export function contacted(a: AppointmentWithPatient): boolean {
  return Boolean(a.unavailabilityId || a.headsUpSent);
}

// The log line that gave the patient their current status: the latest line
// with a result (an answer, "Needs staff call", "Cancelled"), or the URGENT
// line. Later lines without a result (a photo, "confirmed the update") don't
// count — they aren't the answer.
function answerLine(a: AppointmentWithPatient): CallLogEntry | undefined {
  return a.callLog?.findLast((e) => e.result || e.detail?.includes("URGENT"));
}

// Which channel the answer came from. Only once there IS an answer (or a
// staff call), never for a patient still waiting or who didn't pick up.
export function answerChannel(a: AppointmentWithPatient): AnswerChannel | undefined {
  const done =
    ANSWERED_STATUSES.includes(a.status) ||
    a.status === "Needs staff call" ||
    a.status === "URGENT – staff call now";
  if (!done) return undefined;
  const line = answerLine(a);
  if (!line) return undefined;
  return line.channel === "WhatsApp" ? "Answered on WhatsApp" : "Answered by call";
}

// Where WhatsApp stands for this patient: whichever happened last. STOP
// always wins. `messages` = every update sent (getMessages).
export function whatsappState(
  a: AppointmentWithPatient,
  messages: SmsMessage[],
): WhatsAppState | undefined {
  if (!a.patient.whatsappOptIn || !contacted(a)) return undefined;
  if (a.whatsappStopped) return "WhatsApp closed (STOP)";

  const mine = messages.filter((m) => m.appointmentId === a.id);
  const updateTexts = new Set(mine.filter((m) => m.channel === "WhatsApp").map((m) => m.text));
  const turns = a.whatsapp ?? [];
  // The latest patient message, and the latest update, in the chat.
  const lastReply = turns.findLastIndex((t) => t.from === "patient");
  const lastUpdate = turns.findLastIndex((t) => t.from === "docdelay" && updateTexts.has(t.text));

  // An update that couldn't go on WhatsApp went by SMS instead. It counts if
  // the patient hasn't written on WhatsApp since.
  const failed = mine
    .filter((m) => m.whatsappFailed)
    .sort((x, y) => x.sentAt.localeCompare(y.sentAt))
    .at(-1);
  if (failed && (lastReply < 0 || failed.sentAt >= turns[lastReply].at)) {
    return "WhatsApp not delivered → SMS";
  }

  if (lastReply >= 0 || lastUpdate >= 0) {
    return lastUpdate > lastReply ? "Update sent (WhatsApp)" : "Replied on WhatsApp";
  }
  // Nothing in the chat yet: an affected patient still waiting has been sent
  // DocDelay's first message. (Someone who answered on a call hasn't.)
  if (a.status === "Affected – needs contact" || a.status === "No answer") return "WhatsApp sent";
  return undefined;
}

// How many photos the patient sent on WhatsApp.
export function photoCount(a: AppointmentWithPatient): number {
  return (a.whatsapp ?? []).filter((t) => t.from === "patient" && t.media === "photo").length;
}

// "📷 WhatsApp: photo received — not read" (or "2 photos"). Grey, no alert.
export function photoNote(count: number): string {
  if (count === 0) return "";
  return count === 1
    ? "📷 WhatsApp: photo received — not read"
    : `📷 WhatsApp: ${count} photos received — not read`;
}

// Everything the row shows about WhatsApp.
export function whatsappRowInfo(
  a: AppointmentWithPatient,
  messages: SmsMessage[],
): WhatsAppRowInfo {
  const optedIn = a.patient.whatsappOptIn === true;
  const reached = contacted(a);
  return {
    okLabel: optedIn && !reached,
    answeredBy: optedIn && reached ? answerChannel(a) : undefined,
    state: whatsappState(a, messages),
    photos: photoCount(a),
    link: optedIn && reached,
  };
}

// The label on each sent update on the Messages page — exactly one per message.
export type MessageChannelLabel = "WhatsApp" | "SMS" | "WhatsApp not delivered → sent by SMS";

export function messageChannelLabel(m: SmsMessage): MessageChannelLabel {
  if (m.whatsappFailed) return "WhatsApp not delivered → sent by SMS";
  return m.channel === "WhatsApp" ? "WhatsApp" : "SMS";
}
