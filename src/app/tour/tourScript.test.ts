// The guided tour's script, run through the real chat code in the fake HMS
// at different times of day (run with: npm test). The tour must work whenever
// a visitor takes it. As in src/hms/unclearReplies.test.ts, the only thing
// swapped out is where a visitor's demo history is kept.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DemoStep } from "@/hms/visitorState";

let steps: DemoStep[] = [];
vi.mock("@/hms/visitorState", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hms/visitorState")>()),
  readSteps: async () => steps,
  writeSteps: async (newSteps: DemoStep[]) => {
    steps = newSteps;
    return true;
  },
  isNearlyFull: async () => false,
  clearSteps: async () => {
    steps = [];
  },
}));

import {
  getAffectedAppointments,
  getAppointment,
  getMessages,
  getPendingUpdates,
  getStaffCallList,
  markDoctorUnavailable,
  resetDemo,
  sendChatMessage,
  sendPendingUpdates,
} from "@/hms/mockHms";
import { interpretWithRules } from "@/lib/understanding";
import { DEMO_PHRASES } from "@/app/calls/[id]/demoPhrases";
import { TOUR_UNAVAILABLE } from "./tourSteps";

// What the chat does with each message (same steps as chatAction in app/actions.ts).
async function patientSays(appointmentId: string, text: string) {
  const appt = (await getAppointment(appointmentId))!;
  const understanding = await interpretWithRules(text, {
    language: appt.patient.preferredLanguage,
    offers: appt.offers ?? [],
  });
  await sendChatMessage(appointmentId, text, understanding);
  return (await getAppointment(appointmentId))!;
}

afterEach(() => {
  vi.useRealTimers();
});

// Times the tour might be taken. India (IST) is where the hospital is; the
// last one is a US evening, which is already the next morning in India.
const WHEN = [
  ["8 AM in India", "2026-09-29T08:00:00+05:30"],
  ["1 PM in India", "2026-09-29T13:00:00+05:30"],
  ["6 PM in India", "2026-09-29T18:00:00+05:30"],
  ["9 PM in India", "2026-09-29T21:00:00+05:30"],
  ["8 PM in New York (5:30 AM next day in India)", "2026-09-29T20:00:00-04:00"],
];

describe.each(WHEN)("the tour at %s", (_label, isoTime) => {
  it("every step gives the result the tour expects", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(isoTime));
    await resetDemo(); // the tour starts with a reset

    // Step 2: Dr. Meera Krishnan unavailable, with the tour's pre-filled times
    const unavailable = (await markDoctorUnavailable({
      doctorId: "doc-cardio",
      reason: "Emergency surgery",
      ...TOUR_UNAVAILABLE,
    }))!;
    // Step 3: patients turn red
    const affected = await getAffectedAppointments(unavailable.id);
    expect(affected.length).toBeGreaterThan(0);
    expect(affected[0].id).toBe("appt-001"); // the first patient the chat calls (English)
    expect(affected[1].id).toBe("appt-002"); // the second (Tamil)

    // Step 4: the first patient taps "I'll wait for a later time today"
    const english = DEMO_PHRASES.English.replies.find((p) => p.intent === "later_today")!;
    const first = await patientSays("appt-001", english.text);
    expect(first.status).toBe("Rescheduled – later today");
    expect(first.timeHistory).toBeTruthy(); // shows "was → now"

    // Step 5: the next patient (Tamil) taps the symptom example
    const second = await patientSays("appt-002", DEMO_PHRASES.Tamil.symptom.text);
    expect(second.status).toBe("URGENT – staff call now");

    // Step 6: the staff call list shows the URGENT patient first
    const staff = await getStaffCallList();
    expect(staff[0].id).toBe("appt-002");

    // Step 7: one text waiting, sent when staff press "Send updates"
    expect(await getPendingUpdates()).toHaveLength(1);
    await sendPendingUpdates();
    const sent = await getMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].toName).toBe(first.patient.name);
  });
});
