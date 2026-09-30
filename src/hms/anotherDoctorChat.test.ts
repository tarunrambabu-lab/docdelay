// Tests for "another doctor today" in CHAT mode — basic (rule-based) mode and
// the AI's tools (run with: npm test). No real AI is called: the AI's tools are
// run directly, exactly as the AI would call them.
//
// As in unclearReplies.test.ts, the only thing swapped out is where a
// visitor's demo history is kept. Dr. Karthik Raman (doc-cardio-2) is the
// approved cover for Dr. Meera Krishnan; his EMPTY slots today are
// 9:30, 10:45, 11:30, 1:15, 2:30, 3:45 and 4:30.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import startingData from "@/hms/mockData.json";
import {
  chooseOffer,
  getAppointment,
  getAppointmentsForDay,
  getDoctors,
  getMessages,
  markDoctorUnavailable,
  recordCallResult,
  sendChatMessage,
  sendPendingUpdates,
  startAiTurn,
} from "@/hms/mockHms";
import { decodeStep, encodeStep } from "@/hms/visitorState";
import type { Language } from "@/hms/types";
import { DEMO_PHRASES } from "@/app/calls/[id]/demoPhrases";
import { anotherDoctorReply } from "@/lib/callScript";
import { noOtherDoctorFreeReply, slotTakenPrefix } from "@/lib/chatReplies";
import { describeTimeChange } from "@/lib/status";
import { interpretWithRules, mentionsHealth } from "@/lib/understanding";

const MEERA = "doc-cardio";
const KARTHIK = "doc-cardio-2";

const away = (fromTime: string, untilTime: string) =>
  markDoctorUnavailable({ doctorId: MEERA, reason: "Emergency surgery", fromTime, untilTime });

const understand = (text: string, language: Language = "English") =>
  interpretWithRules(text, { language, offers: [] });

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
const lastReply = async (id: string) => (await getAppointment(id))!.chat!.at(-1)!.text;
const times = (offers?: { startTime: string }[]) => (offers ?? []).map((o) => o.startTime);

beforeEach(() => {
  steps = [];
});

describe("basic mode: what counts as asking for another doctor", () => {
  const ASKS: [Language, string][] = [
    ["English", "another doctor please"],
    ["English", "can I see a different doctor today"],
    ["English", "No, another doctor please"],
    ["English", "5"],
    ["Tamil", "vera doctor paakanum"],
    ["Tamil", "veroru doctor venum"],
    ["Tamil", "innoru doctor kitta kaatanum"],
    ["Tamil", "வேறு டாக்டர் பார்க்கணும்"],
    ["Hindi", "doosre doctor se milna hai"],
    ["Hindi", "kisi aur doctor ko dikhana hai"],
    ["Hindi", "दूसरे डॉक्टर से मिलना है"],
    // With "today" in them — still another doctor, not "later today" or another day
    ["Tamil", "vera doctor inikki paakanum"],
    ["Hindi", "doosre doctor ke saath aaj milna hai"],
  ];
  it.each(ASKS)("%s: %s → another doctor", async (language, text) => {
    const understood = await understand(text, language);
    expect(understood.intent).toBe("another_doctor");
    expect(understood.intent).not.toBe("another_day");
    expect(mentionsHealth(text)).toBe(false);
  });

  it('"vera doctor paakanum" does NOT trigger URGENT', async () => {
    expect(mentionsHealth("vera doctor paakanum")).toBe(false);
    expect((await understand("vera doctor paakanum", "Tamil")).intent).not.toBe("health_concern");
  });

  it.each([
    ["English", "doctor, my chest hurts"],
    ["Tamil", "vera doctor, nenju vali"],
    ["Hindi", "doosre doctor, seene mein dard"],
  ] as [Language, string][])("%s: %s → still URGENT (health first)", async (language, text) => {
    expect(mentionsHealth(text)).toBe(true);
    expect((await understand(text, language)).intent).toBe("health_concern");
  });

  it('"no" in front: NOT asking for another doctor (and not cancelling)', async () => {
    expect((await understand("I don't want another doctor, I'll wait")).intent).toBe("later_today");
    for (const [language, text] of [
      ["Tamil", "vera doctor venaam"],
      ["Hindi", "doosra doctor nahi chahiye"],
    ] as [Language, string][]) {
      const intent = (await understand(text, language)).intent;
      expect(intent).not.toBe("another_doctor");
      expect(intent).not.toBe("cancel");
      expect(intent).toBe("unclear"); // DocDelay asks again
    }
  });

  it('"vera naal", "doosre din" and "another day" still mean another day', async () => {
    expect((await understand("vera naal", "Tamil")).intent).toBe("another_day");
    expect((await understand("doosre din", "Hindi")).intent).toBe("another_day");
    expect((await understand("another day")).intent).toBe("another_day");
  });

  it("the suggested-phrase buttons mean another doctor in every language", async () => {
    for (const language of ["English", "Tamil", "Hindi"] as Language[]) {
      const phrase = DEMO_PHRASES[language].anotherDoctor;
      expect(phrase.intent).toBe("another_doctor");
      expect((await understand(phrase.text, language)).intent).toBe("another_doctor");
      expect(mentionsHealth(phrase.text)).toBe(false);
      if (language !== "English") expect(phrase.meaning).toBe("I'd like to see another doctor today");
    }
  });
});

describe("the chat opening", () => {
  it("mentions option 5 when a slot is free (English, Tamil, Hindi)", async () => {
    await away("09:00", "12:00");
    // appt-001 English, appt-002 Tamil, appt-003 Hindi
    await patientSays("appt-001", "hmm");
    await patientSays("appt-002", "hmm");
    await patientSays("appt-003", "hmm");
    const opening = async (id: string) => (await getAppointment(id))!.chat![0].text;
    expect(await opening("appt-001")).toMatch(
      /Press 5 to see another doctor from the same department today\.$/,
    );
    expect(await opening("appt-002")).toMatch(/வேறு மருத்துவரைப் பார்க்க 5 ஐ அழுத்தவும்\.$/);
    expect(await opening("appt-003")).toMatch(/किसी दूसरे डॉक्टर से मिलने के लिए 5 दबाएँ।$/);
  });

  it("doesn't mention it when no approved doctor is free", async () => {
    await away("16:45", "17:00"); // appt-023 at 4:45 PM (Hindi): Dr. Karthik's 4:45 is booked
    await patientSays("appt-023", "hmm");
    const opening = (await getAppointment("appt-023"))!.chat![0].text;
    expect(opening).toMatch(/हमारे फ्रंट डेस्क से बात करने के लिए 4 दबाएँ।$/);
    expect(opening).not.toContain("5 दबाएँ"); // (it does contain the times 4:45 and 5:00)
    expect(opening).not.toContain("दूसरे डॉक्टर");
  });
});

describe("basic mode: the conversation", () => {
  it("ask → Dr. Karthik's times → pick A → rebooked, with one text", async () => {
    await away("09:00", "12:00");
    const asked = await patientSays("appt-001", "another doctor please");
    expect(asked.offersBecause).toBe("another doctor");
    expect(times(asked.offers)).toEqual(["09:30", "10:45", "11:30"]);
    expect(asked.offers!.every((o) => o.doctorId === KARTHIK)).toBe(true);
    expect(await lastReply("appt-001")).toBe(
      "Another doctor from the same department can see you today: " +
        "A) Dr. Karthik Raman, 9:30 AM, B) Dr. Karthik Raman, 10:45 AM, C) Dr. Karthik Raman, 11:30 AM. " +
        "Please choose A, B or C. If none of these suit you, our front desk will call you.",
    );

    const booked = await patientSays("appt-001", "A");
    expect(booked.status).toBe("Rebooked – another doctor");
    expect(booked.doctorId).toBe(KARTHIK);
    expect(await lastReply("appt-001")).toBe(
      "Thank you. Your new appointment is today at 9:30 AM with Dr. Karthik Raman.",
    );
    expect(describeTimeChange(booked, await getDoctors())).toBe(
      "was 9:00 AM, Dr. Meera Krishnan → now 9:30 AM, Dr. Karthik Raman",
    );
    await sendPendingUpdates();
    const texts = (await getMessages()).filter((m) => m.appointmentId === "appt-001");
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toContain("now with Dr. Karthik Raman (instead of Dr. Meera Krishnan)");
  });

  it("the suggested phrase, then a pick, works in Tamil and Hindi too", async () => {
    await away("09:00", "12:00");
    for (const [id, language] of [
      ["appt-002", "Tamil"],
      ["appt-003", "Hindi"],
    ] as [string, Language][]) {
      await patientSays(id, DEMO_PHRASES[language].anotherDoctor.text);
      const booked = await patientSays(id, "A");
      expect(booked.status).toBe("Rebooked – another doctor");
      expect(booked.doctorId).toBe(KARTHIK);
    }
  });

  it('a time can be picked by "first one" or by saying it', async () => {
    await away("09:00", "12:00");
    await patientSays("appt-001", "another doctor");
    expect((await patientSays("appt-001", "the first one")).startTime).toBe("09:30");
    await patientSays("appt-002", "vera doctor paakanum");
    expect((await patientSays("appt-002", "11:30")).startTime).toBe("11:30");
  });

  it("no approved doctor free → says so and asks again; the patient stays in the chat", async () => {
    await away("16:45", "17:00");
    const appt = await patientSays("appt-023", "doosre doctor se milna hai");
    expect(appt.status).toBe("Affected – needs contact");
    expect(appt.offers).toBeUndefined();
    expect(await lastReply("appt-023")).toBe(noOtherDoctorFreeReply("Hindi"));
  });

  it("slot taken just before → 'Sorry, that time was just taken' and fresh times", async () => {
    await away("09:00", "12:00");
    await patientSays("appt-001", "another doctor");
    await patientSays("appt-004", "another doctor"); // English, 9:45 AM → 10:45, 11:30, 1:15
    await patientSays("appt-002", "vera doctor paakanum"); // Tamil, 9:15 → 9:30, 10:45, 11:30
    await patientSays("appt-001", "A"); // takes 9:30
    const second = await patientSays("appt-002", "A"); // 9:30 is gone
    expect(second.status).toBe("Affected – needs contact");
    expect(times(second.offers)).toEqual(["10:45", "11:30", "13:15"]);
    expect(await lastReply("appt-002")).toMatch(new RegExp(`^${slotTakenPrefix("Tamil")} `));
  });

  it("slot taken and none left → sorry, then the other choices", async () => {
    await away("15:30", "17:00");
    await patientSays("appt-022", "doosre doctor se milna hai"); // only 4:30
    await patientSays("appt-021", "another doctor"); // 3:45 and 4:30
    await patientSays("appt-021", "B"); // takes 4:30
    const appt = await patientSays("appt-022", "A");
    expect(appt.status).toBe("Affected – needs contact");
    expect(appt.offers).toBeUndefined();
    expect(await lastReply("appt-022")).toBe(
      `${slotTakenPrefix("Hindi")} ${noOtherDoctorFreeReply("Hindi")}`,
    );
  });

  it("changes their mind: 'another day' → Dr. Meera's other-day times", async () => {
    await away("09:00", "12:00");
    await patientSays("appt-001", "another doctor");
    const appt = await patientSays("appt-001", "another day");
    expect(appt.offersBecause).toBe("asked");
    expect(appt.offers!.length).toBeGreaterThan(0);
    expect(appt.offers!.every((o) => o.doctorId === undefined && o.dayOffset > 0)).toBe(true);
  });

  it("a health concern while looking at Dr. Karthik's times → URGENT, nothing booked", async () => {
    await away("09:00", "12:00");
    await patientSays("appt-001", "another doctor");
    const appt = await patientSays("appt-001", "doctor, my chest hurts");
    expect(appt.status).toBe("URGENT – staff call now");
    expect(appt.offers).toBeUndefined();
    expect(appt.doctorId).toBe(MEERA);
  });

  it("'talk to a person' while looking at Dr. Karthik's times → staff call, with the right note", async () => {
    await away("09:00", "12:00");
    await patientSays("appt-001", "another doctor");
    const appt = await patientSays("appt-001", "I want to talk to a person");
    expect(appt.status).toBe("Needs staff call");
    expect(appt.note).toBe("Wanted another doctor today");
  });

  it("Dr. Karthik's own patients are never moved", async () => {
    const snapshot = async () =>
      JSON.stringify(
        (await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((d) => getAppointmentsForDay(KARTHIK, d))))
          .flat()
          .filter((a) => Number(a.id.slice(5)) > 490),
      );
    const before = await snapshot();
    await away("09:00", "17:00");
    for (const id of ["appt-001", "appt-002", "appt-003", "appt-010", "appt-021"]) {
      await patientSays(id, "another doctor");
      await patientSays(id, "A");
    }
    expect(await snapshot()).toBe(before);
  });
});

describe("AI mode: the new tools (run directly — no AI call)", () => {
  afterEach(() => {
    const ortho = startingData.doctors.find((d) => d.id === "doc-ortho")! as {
      canCoverFor?: string[];
    };
    delete ortho.canCoverFor;
  });

  it("check_another_doctor_slots returns only approved, same-specialty slots", async () => {
    // Even with the orthopaedist wrongly listed (free at 9:45 today).
    const ortho = startingData.doctors.find((d) => d.id === "doc-ortho")! as {
      canCoverFor?: string[];
    };
    ortho.canCoverFor = [MEERA];
    await away("09:00", "12:00");
    const turn = (await startAiTurn("appt-001"))!;
    const result = turn.runTool("check_another_doctor_slots", {}) as {
      slots: { start_time: string; say: string }[];
    };
    expect(result.slots.map((s) => s.start_time)).toEqual(["09:30", "10:45", "11:30"]);
    for (const slot of result.slots) {
      expect(slot.say).toMatch(/^Dr\. Karthik Raman, today, /);
      expect(slot.say).not.toContain("Arjun");
    }
  });

  it("book_with_another_doctor only books an allowed slot with an approved doctor", async () => {
    await away("09:00", "12:00");
    const turn = (await startAiTurn("appt-001"))!;
    // A time that isn't one of Dr. Karthik's free slots (the orthopaedist's 9:45,
    // Dr. Karthik's booked 9:45, a time before the patient's original 9:00)
    turn.runTool("check_another_doctor_slots", {});
    for (const time of ["09:45", "08:30", "17:00"]) {
      expect(turn.runTool("book_with_another_doctor", { start_time: time }).ok).toBe(false);
    }
    expect(turn.outcome()).toBeUndefined();

    expect(turn.runTool("book_with_another_doctor", { start_time: "10:45" }).ok).toBe(true);
    expect(await turn.save("B please", "")).toBe(true);
    const appt = (await getAppointment("appt-001"))!;
    expect(appt.status).toBe("Rebooked – another doctor");
    expect(appt.doctorId).toBe(KARTHIK);
    expect(appt.startTime).toBe("10:45");
    // DocDelay's fixed confirmation, not AI text
    expect(appt.chat!.at(-1)!.text).toBe(anotherDoctorReply("English", "10:45", "Dr. Karthik Raman"));
  });

  it("the patient can pick in their NEXT message (found in a real-AI check, 1 Oct 2026)", async () => {
    await away("09:00", "12:00");
    // Message 1: the AI offers Dr. Karthik's times
    const first = (await startAiTurn("appt-003"))!; // Hindi, 9:30 AM
    first.runTool("check_another_doctor_slots", {});
    expect(await first.save("doosre doctor se milna hai", "…")).toBe(true);
    // Message 2: "A" — the AI books straight away, without checking again
    const second = (await startAiTurn("appt-003"))!;
    expect(second.runTool("book_with_another_doctor", { start_time: "09:30" }).ok).toBe(true);
    expect(await second.save("A", "")).toBe(true);
    const appt = (await getAppointment("appt-003"))!;
    expect(appt.status).toBe("Rebooked – another doctor");
    expect(appt.doctorId).toBe(KARTHIK);
  });

  it("a slot someone else already took is never offered or booked", async () => {
    await away("09:00", "12:00");
    // appt-001 takes Dr. Karthik's 9:30 in Buttons mode
    await recordCallResult("appt-001", "Wants another doctor today");
    expect(await chooseOffer("appt-001", 0)).toBe("booked");
    // The AI's turn for appt-002 (Tamil, 9:15) then only gets the free ones…
    const turn = (await startAiTurn("appt-002"))!;
    const result = turn.runTool("check_another_doctor_slots", {}) as {
      slots: { start_time: string }[];
    };
    expect(result.slots.map((s) => s.start_time)).toEqual(["10:45", "11:30", "13:15"]);
    // …and can't book 9:30 anyway
    expect(turn.runTool("book_with_another_doctor", { start_time: "09:30" }).ok).toBe(false);
    expect(turn.outcome()).toBeUndefined();
  });

  it("offers in one turn are never a mix of doctors", async () => {
    await away("09:00", "12:00");
    const turn = (await startAiTurn("appt-001"))!;
    turn.runTool("check_free_slots", { when: "other_days" });
    const doctorSlots = turn.runTool("check_another_doctor_slots", {}) as { slots: { say: string }[] };
    expect(doctorSlots.slots.every((s) => s.say.startsWith("Dr. Karthik Raman"))).toBe(true);
    const ownSlots = turn.runTool("check_free_slots", { when: "other_days" }) as {
      slots: { say: string }[];
    };
    expect(ownSlots.slots.length).toBeGreaterThan(0);
    expect(ownSlots.slots.some((s) => s.say.includes("Karthik"))).toBe(false);
  });

  it("the offers the AI made stay with Dr. Karthik when saved and replayed", async () => {
    await away("09:00", "12:00");
    const turn = (await startAiTurn("appt-001"))!;
    turn.runTool("check_another_doctor_slots", {});
    expect(await turn.save("another doctor please", "Here are the times …")).toBe(true);
    const appt = (await getAppointment("appt-001"))!;
    expect(appt.offersBecause).toBe("another doctor");
    expect(appt.offers!.every((o) => o.doctorId === KARTHIK)).toBe(true);
    // …so a pick in basic mode afterwards books with Dr. Karthik
    expect((await patientSays("appt-001", "C")).doctorId).toBe(KARTHIK);
  });
});

describe("saved demos (the cookie)", () => {
  it("an AI booking with another doctor, and its offers, come back the same", () => {
    const step: DemoStep = {
      kind: "ai",
      at: 1_790_000_000_000,
      appointmentId: "appt-001",
      text: "A",
      reply: "",
      offers: [
        { dayOffset: 0, startTime: "09:30", doctorId: KARTHIK },
        { dayOffset: 0, startTime: "10:45", doctorId: KARTHIK },
      ],
      action: { kind: "book", dayOffset: 0, startTime: "09:30", doctorId: KARTHIK },
    };
    const back = decodeStep(encodeStep(step))!;
    expect(back).toMatchObject({
      kind: "ai",
      appointmentId: "appt-001",
      offers: step.offers,
      action: step.action,
    });
  });

  it("older saved AI bookings (no doctor) still read the same", () => {
    const step: DemoStep = {
      kind: "ai",
      at: 1_790_000_000_000,
      appointmentId: "appt-001",
      text: "B",
      reply: "",
      offers: [{ dayOffset: 3, startTime: "16:15" }],
      action: { kind: "book", dayOffset: 3, startTime: "16:15" },
    };
    const code = encodeStep(step);
    expect(code).toContain(".b3-1615.");
    const back = decodeStep(code)! as Extract<DemoStep, { kind: "ai" }>;
    expect(back.action).toEqual({ kind: "book", dayOffset: 3, startTime: "16:15" });
    expect(back.offers).toEqual([{ dayOffset: 3, startTime: "16:15" }]);
  });
});
