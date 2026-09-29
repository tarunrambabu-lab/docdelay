// Full chat runs with the demo phrases, through the real chat code in the fake
// HMS, in BASIC mode (run with: npm test). As in src/hms/unclearReplies.test.ts,
// the only thing swapped out is where a visitor's demo history is kept.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoStep } from "@/hms/visitorState";
import type { Language } from "@/hms/types";

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
import { OFFER_LETTERS } from "@/lib/callScript";
import { interpretWithRules } from "@/lib/understanding";
import { DEMO_PHRASES } from "./demoPhrases";

// Dr. Meera Krishnan's patients today: 9:00 English, 9:15 Tamil, 9:30 Hindi.
const PATIENT: Record<Language, string> = {
  English: "appt-001",
  Tamil: "appt-002",
  Hindi: "appt-003",
};

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

beforeEach(async () => {
  steps = [];
  await markDoctorUnavailable({
    doctorId: "doc-cardio",
    reason: "Emergency surgery",
    fromTime: "09:00",
    untilTime: "12:00",
  });
});

describe.each(Object.keys(PATIENT) as Language[])("%s patient, tapping each phrase", (language) => {
  const id = PATIENT[language];
  const phrase = (intent: string) => DEMO_PHRASES[language].replies.find((p) => p.intent === intent)!;

  it("later today → rebooked later today (or other-day offers if there's no room)", async () => {
    const appt = await patientSays(id, phrase("later_today").text);
    if (appt.status === "Rescheduled – later today") expect(appt.timeHistory).toBeTruthy();
    else {
      expect(appt.status).toBe("Affected – needs contact");
      expect(appt.offers?.length).toBeGreaterThan(0);
    }
  });

  it("Thursday after 4 → offers on screen → each pick books that offer", async () => {
    const withOffers = await patientSays(id, phrase("another_day").text);
    const offers = withOffers.offers ?? [];
    expect(offers.length).toBeGreaterThan(0);
    // Pick each offer in turn (A, B, C …), starting from a fresh demo each time.
    for (const [i, letter] of OFFER_LETTERS.slice(0, offers.length).entries()) {
      steps = [];
      await markDoctorUnavailable({
        doctorId: "doc-cardio",
        reason: "Emergency surgery",
        fromTime: "09:00",
        untilTime: "12:00",
      });
      await patientSays(id, phrase("another_day").text);
      const appt = await patientSays(id, letter);
      expect(appt.status).toBe("Rescheduled – another day");
      expect(appt.dayOffset).toBe(offers[i].dayOffset);
      expect(appt.startTime).toBe(offers[i].startTime);
    }
  });

  it("cancel → Cancelled", async () => {
    expect((await patientSays(id, phrase("cancel").text)).status).toBe("Cancelled");
  });

  it("talk to a person → Needs staff call", async () => {
    expect((await patientSays(id, phrase("talk_to_person").text)).status).toBe("Needs staff call");
  });

  it("symptom example → URGENT", async () => {
    expect((await patientSays(id, DEMO_PHRASES[language].symptom.text)).status).toBe(
      "URGENT – staff call now",
    );
  });
});
