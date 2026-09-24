"use server";

// Server Actions: code that runs on the server when a form is submitted.
// They check the input, then ask the hms module to change the data.
// (They never touch the data files themselves.)

import { refresh } from "next/cache";
import { getDoctor, markDoctorUnavailable, resetDemo } from "@/hms/mockHms";
import { UNAVAILABILITY_REASONS, type UnavailabilityReason } from "@/hms/types";
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

export async function resetDemoAction(): Promise<void> {
  await resetDemo();
  refresh();
}
