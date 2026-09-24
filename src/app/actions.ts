"use server";

// Server Actions: code that runs on the server when a form or button is used.
// They check the input, then ask the hms module to change the data.
// (They never touch the data files themselves.)

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  getAppointment,
  getDoctor,
  markDoctorUnavailable,
  recordCallResult,
  resetDemo,
  sendPendingUpdates,
} from "@/hms/mockHms";
import {
  CALL_RESULTS,
  UNAVAILABILITY_REASONS,
  type CallResult,
  type UnavailabilityReason,
} from "@/hms/types";
import { isValidTime } from "@/lib/time";

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

  await markDoctorUnavailable({
    doctorId,
    reason: reason as UnavailabilityReason,
    fromTime,
    untilTime,
  });

  refresh(); // reload the page's data so the banner and statuses appear
  return { ok: true };
}

// Save the patient's answer from the call simulator, then show the next patient.
// For "Later today" the hms finds a new time straight away, and we open the
// "answered" view so the phone card can tell the patient their new time.
export async function recordCallAction(appointmentId: string, result: string): Promise<void> {
  if (!CALL_RESULTS.includes(result as CallResult)) return; // ignore anything unexpected
  const saved = await recordCallResult(appointmentId, result as CallResult);

  if (saved && result === "Wants later today") {
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
