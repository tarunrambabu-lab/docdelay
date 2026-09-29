// Tests for "two unclear replies in a row → Needs staff call" (run with: npm test).
//
// These run the real chat code in the fake HMS. The only thing swapped out is
// where a visitor's demo history is kept: normally a browser cookie, here a
// plain list in memory (a test has no browser).
import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { getAppointment, markDoctorUnavailable, sendChatMessage } from "@/hms/mockHms";
import { interpretWithRules } from "@/lib/understanding";

// appt-001: Dr. Meera Krishnan, today at 9:00.
const APPOINTMENT = "appt-001";

// What the chat does with each message (same steps as chatAction in app/actions.ts).
async function patientSays(text: string) {
  const appt = (await getAppointment(APPOINTMENT))!;
  const understanding = await interpretWithRules(text, {
    language: appt.patient.preferredLanguage,
    offers: appt.offers ?? [],
  });
  await sendChatMessage(APPOINTMENT, text, understanding);
  return (await getAppointment(APPOINTMENT))!;
}

beforeEach(async () => {
  steps = [];
  await markDoctorUnavailable({
    doctorId: "doc-cardio",
    reason: "Emergency surgery",
    fromTime: "09:00",
    untilTime: "11:00",
  });
});

describe("C. two unclear replies", () => {
  it("C1: two unclear replies in a row → Needs staff call – Couldn't understand", async () => {
    await patientSays("hmm");
    const appt = await patientSays("what?");
    expect(appt.status).toBe("Needs staff call");
    expect(appt.note).toBe("Couldn't understand");
  });

  it("C2: one unclear reply, then a clear one → NOT sent to staff", async () => {
    await patientSays("hmm");
    const appt = await patientSays("cancel");
    expect(appt.status).toBe("Cancelled");
  });

  it("C3: a clear reply resets the count → a later unclear reply is only 1 of 2", async () => {
    await patientSays("hmm");
    await patientSays("after 4"); // clear: DocDelay asks "today, or another day?"
    const appt = await patientSays("hmm");
    expect(appt.status).toBe("Affected – needs contact");
  });

  it("C4: one unclear reply, then a symptom → URGENT, not 'Couldn't understand'", async () => {
    await patientSays("hmm");
    const appt = await patientSays("I feel dizzy");
    expect(appt.status).toBe("URGENT – staff call now");
    expect(appt.note).not.toBe("Couldn't understand");
  });
});
