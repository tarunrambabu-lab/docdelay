"use server";

// Server Actions: code that runs on the server when a form or button is used.
// They check the input, then ask the hms module to change the data.
// (They never touch the data files themselves.)

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  chooseOffer,
  getAppointment,
  getDoctor,
  getUnavailability,
  changeExpectedReturn,
  markDoctorAvailable,
  markFalseAlarm,
  sendChatMessage,
  markDoctorUnavailable,
  recordCallResult,
  resetDemo,
  sendPendingUpdates,
  sendWhatsAppMessage,
} from "@/hms/mockHms";
import {
  CALL_RESULTS,
  UNAVAILABILITY_REASONS,
  type CallResult,
  type UnavailabilityReason,
  type WhatsAppMedia,
} from "@/hms/types";
import { formatTime, isValidTime } from "@/lib/time";
import { activeEngine, interpretWithRules, mentionsHealth } from "@/lib/understanding";
import { aiChatTurn } from "@/lib/understanding/aiChat";
import { countOneAiMessage } from "@/lib/understanding/usage";
import { MAX_CHAT_TEXT } from "@/hms/visitorState";

// What the "unavailable" form gets back: nothing yet, success, or an error.
export type MarkUnavailableResult = { ok?: boolean; error?: string };

export async function markUnavailableAction(
  _previous: MarkUnavailableResult,
  formData: FormData,
): Promise<MarkUnavailableResult> {
  const doctorId = String(formData.get("doctorId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const fromTime = String(formData.get("fromTime") ?? "");
  const untilTime = String(formData.get("untilTime") ?? "");

  // Check the input before changing anything.
  if (!(await getDoctor(doctorId))) {
    return { error: "Unknown doctor." };
  }
  if (!UNAVAILABILITY_REASONS.includes(reason as UnavailabilityReason)) {
    return { error: "Please choose a reason." };
  }
  if (!isValidTime(fromTime) || !isValidTime(untilTime)) {
    return { error: "Please enter both times." };
  }
  if (untilTime <= fromTime) {
    return { error: "“Expected until” must be later than “From”." };
  }

  const saved = await markDoctorUnavailable({
    doctorId,
    reason: reason as UnavailabilityReason,
    fromTime,
    untilTime,
  });
  if (!saved) {
    return { error: "This demo has too much history. Press “Reset demo” to start again." };
  }

  refresh(); // reload the page's data so the banner and statuses appear
  return { ok: true };
}

// "Change expected return time" (and "Still away: new expected time" in the
// "is the doctor back?" check). The time is recorded and shown; no patient is
// moved and no message is sent (see changeExpectedReturn in the hms module).
export type ReturnTimeResult = { ok?: boolean; error?: string };

export async function changeReturnTimeAction(
  _previous: ReturnTimeResult,
  formData: FormData,
): Promise<ReturnTimeResult> {
  const unavailabilityId = String(formData.get("unavailabilityId") ?? "");
  const untilTime = String(formData.get("untilTime") ?? "");
  const stillAway = formData.get("stillAway") === "1"; // sent from the check

  const absence = await getUnavailability(unavailabilityId);
  if (!absence) return { error: "Unknown absence." };
  if (absence.markedAvailableAt) {
    return { error: "This doctor has already been marked available." };
  }
  if (!isValidTime(untilTime)) return { error: "Please enter a time." };
  if (untilTime <= absence.fromTime) {
    return {
      error: `The expected return time must be later than ${formatTime(absence.fromTime)}, when the absence started.`,
    };
  }
  if (stillAway && untilTime <= absence.untilTime) {
    return { error: `Please enter a time later than ${formatTime(absence.untilTime)}.` };
  }
  if (untilTime === absence.untilTime) return { ok: true }; // nothing to change

  if (!(await changeExpectedReturn(unavailabilityId, untilTime))) {
    return { error: "This demo has too much history. Press “Reset demo” to start again." };
  }
  refresh();
  return { ok: true };
}

// "Mark doctor available": the doctor is physically back (pressed after the
// confirm question). Ends the absence; nobody is moved.
export async function markAvailableAction(unavailabilityId: string): Promise<void> {
  await markDoctorAvailable(unavailabilityId);
  refresh();
}

// Save the patient's answer from the call simulator.
// - If they got a new time today, open the "answered" view so the phone card
//   can tell them their new time.
// - If they're now being offered other days ("2", or "1" with no room today),
//   the same patient stays on screen with the offers.
// - Otherwise the next patient is shown.
export async function recordCallAction(appointmentId: string, result: string): Promise<void> {
  if (!CALL_RESULTS.includes(result as CallResult)) return; // ignore anything unexpected
  await recordCallResult(appointmentId, result as CallResult);

  const appt = await getAppointment(appointmentId);
  if (appt?.status === "Rescheduled – later today") {
    redirect(`/calls/${appt.unavailabilityId}?answered=${appointmentId}`);
  }
  refresh();
}

// The patient picked an other-day offer (0 = A, 1 = B, …) or null for
// "None of these – call me". If booked, the phone card confirms the new day.
export async function chooseOfferAction(
  appointmentId: string,
  choice: number | null,
): Promise<void> {
  const outcome = await chooseOffer(appointmentId, choice);

  if (outcome === "booked") {
    const appt = await getAppointment(appointmentId);
    redirect(`/calls/${appt?.unavailabilityId}?answered=${appointmentId}`);
  }
  refresh();
}

export async function resetDemoAction(): Promise<void> {
  await resetDemo();
  refresh();
}

// "Send" all pending text updates (simulated — nothing is really sent).
export async function sendUpdatesAction(): Promise<void> {
  await sendPendingUpdates();
  refresh();
}

// Chat mode: the operator typed what the patient said.
// 1. SAFETY first: the rule-based health check runs on every message. Any
//    health words → the rule-based URGENT escalation, never the AI.
//    In the same way, if the rule-based reading is "another doctor" ("vera
//    doctor paakanum", "doosre doctor", "5", …), the rule-based stand-in
//    handles the message, never the AI (the AI sometimes missed it).
// 2. If the AI is on (settings + API key): check the spending limits (hit →
//    Buttons mode with a notice), then let the AI handle the message. If the
//    AI fails for any reason, the rule-based stand-in handles THIS message.
// 3. Otherwise (or as the fallback): the rule-based stand-in.
// If an outcome was recorded, show the finished chat; if not, stay on the chat.
export async function chatAction(
  appointmentId: string,
  message: string,
): Promise<{ error?: string } | void> {
  const text = message.trim().slice(0, MAX_CHAT_TEXT);
  if (!text) return;
  const appt = await getAppointment(appointmentId);
  if (!appt || appt.status !== "Affected – needs contact") return;
  const callsPage = `/calls/${appt.unavailabilityId}`;

  // The rule-based reading wins for a health concern and for "another doctor".
  const context = { language: appt.patient.preferredLanguage, offers: appt.offers ?? [] };
  const rulesFirst =
    mentionsHealth(text) || (await interpretWithRules(text, context)).intent === "another_doctor";

  let handled = false;
  if (activeEngine() === "claude" && !rulesFirst) {
    if ((await countOneAiMessage()) !== "ok") redirect(`${callsPage}?mode=buttons&notice=limit`);
    handled = (await aiChatTurn(appointmentId, text)).ok; // failed → rule-based below
  }
  if (!handled) {
    const understanding = await interpretWithRules(text, context);
    const saved = await sendChatMessage(appointmentId, text, understanding);
    if (!saved) {
      return { error: "This demo has too much history. Press “Reset demo” to start again." };
    }
  }

  const after = await getAppointment(appointmentId);
  if (after && after.status !== "Affected – needs contact") {
    redirect(`${callsPage}?mode=chat&answered=${appointmentId}`);
  }
  refresh();
}

// WhatsApp screen: the patient tapped an option, typed a message, or sent a
// voice note / photo (demo). The hms module does everything — the health
// check first, then the WhatsApp rules. WhatsApp never uses the AI.
// `media`: "voice" = `message` is what the patient said; "photo" = no text.
export async function whatsappAction(
  appointmentId: string,
  message: string,
  media?: WhatsAppMedia,
): Promise<{ notice?: string } | void> {
  if (media !== undefined && media !== "voice" && media !== "photo") return; // ignore anything unexpected
  const result = await sendWhatsAppMessage(appointmentId, String(message), media);
  if (result === "ignored") {
    return {
      notice:
        "DocDelay didn’t reply to that message: WhatsApp is closed for this patient, or there " +
        "was nothing to answer. (If this demo has a lot of history, press “Reset demo”.)",
    };
  }
  refresh();
}

// Staff: an URGENT flag was a false alarm.
export async function falseAlarmAction(appointmentId: string): Promise<void> {
  await markFalseAlarm(appointmentId);
  refresh();
}
