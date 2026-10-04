// Tests for the line a patient gets when the slot they picked is refused —
// run with: npm test.
//
//   - Refused because the doctor's expected return time was made LATER after
//     the slot was offered (12:30 picked, doctor now back at 2:00):
//       "Sorry, Dr. … will now be back at [time], so that time is no longer
//        available."
//   - Refused because someone else booked it meanwhile: still
//       "Sorry, that time was just taken."
// Only the line differs; which fresh options follow is unchanged.
//
// These run the real code in the fake HMS. NO real AI is called: the AI is
// replaced by a pretend one that uses the tools and replies as each test says.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoStep } from "@/hms/visitorState";
import type { AiTurn } from "@/hms/mockHms";

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

let script: (turn: AiTurn) => string = () => "";
vi.mock("@/lib/understanding/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/understanding/claude")>()),
  runClaudeTurn: async (turn: AiTurn) => ({
    reply: script(turn),
    usage: { calls: 1, inputTokens: 0, outputTokens: 0 },
  }),
}));

import {
  changeExpectedReturn,
  chooseOffer,
  getAppointment,
  markDoctorUnavailable,
  recordCallResult,
  sendChatMessage,
  sendWhatsAppMessage,
  startAiTurn,
} from "@/hms/mockHms";
import type { Language } from "@/hms/types";
import { doctorBackLaterPrefix, slotTakenPrefix } from "@/lib/chatReplies";
import { aiChatTurn } from "@/lib/understanding/aiChat";
import type { Understanding } from "@/lib/understanding/types";

const MEERA = "doc-cardio";
const KARTHIK = "doc-cardio-2";
const NIKHIL = "appt-001"; // 9:00, English, WhatsApp OK
const GANESH = "appt-002"; // 9:15, Tamil, not on WhatsApp
const KIRAN = "appt-003"; // 9:30, Hindi, WhatsApp OK
const MEERA_NAMES: Record<Language, string> = {
  English: "Dr. Meera Krishnan",
  Tamil: "டாக்டர் மீரா கிருஷ்ணன் (Dr. Meera Krishnan)",
  Hindi: "डॉ. मीरा कृष्णन (Dr. Meera Krishnan)",
};

// (Two absences marked in the same millisecond would share an id, so wait a moment.)
const away = async (doctorId = MEERA, untilTime = "12:00") => {
  await new Promise((resolve) => setTimeout(resolve, 3));
  return (await markDoctorUnavailable({
    doctorId,
    reason: "Emergency surgery",
    fromTime: "09:00",
    untilTime,
  }))!.id;
};
const appt = async (id: string) => (await getAppointment(id))!;
const TODAY_AFTER_12: Understanding = {
  intent: "later_today",
  preferences: { dayOffset: 0, after: "12:00" },
};
const PICK_A: Understanding = { intent: "choose_offer", preferences: {}, offerIndex: 0 };
const lastChat = async (id: string) => (await appt(id)).chat!.at(-1)!.text;
const lastWhatsApp = async (id: string) => (await appt(id)).whatsapp!.at(-1)!.text;

beforeEach(() => {
  steps = [];
  vi.spyOn(console, "log").mockImplementation(() => {}); // quiet AI cost lines
});

describe("the new line's wording", () => {
  it("English, exactly as agreed", () => {
    expect(doctorBackLaterPrefix("English", "Dr. Meera Krishnan", "14:00")).toBe(
      "Sorry, Dr. Meera Krishnan will now be back at 2:00 PM, so that time is no longer available.",
    );
  });

  it("Tamil and Hindi name the doctor and the time, with AM/PM", () => {
    for (const language of ["Tamil", "Hindi"] as Language[]) {
      const line = doctorBackLaterPrefix(language, MEERA_NAMES[language], "14:00");
      expect(line).toContain(MEERA_NAMES[language]);
      expect(line).toContain("(2:00 PM)");
      expect(line).not.toBe(slotTakenPrefix(language));
    }
  });
});

describe("refused because the doctor is now back LATER → the real reason", () => {
  it("chat (basic mode), Tamil: the new line, then the same fresh options as before", async () => {
    const id = await away();
    await sendChatMessage(GANESH, "today after 12", TODAY_AFTER_12);
    expect((await appt(GANESH)).offers![0]).toMatchObject({ dayOffset: 0, startTime: "12:30" });
    await changeExpectedReturn(id, "14:00");
    await sendChatMessage(GANESH, "A", PICK_A);

    const reply = await lastChat(GANESH);
    const line = doctorBackLaterPrefix("Tamil", MEERA_NAMES.Tamil, "14:00");
    expect(reply.startsWith(`${line} `)).toBe(true);
    expect(reply).not.toContain(slotTakenPrefix("Tamil"));
    // Unchanged: still waiting, and the fresh options are other days.
    const ganesh = await appt(GANESH);
    expect(ganesh.status).toBe("Affected – needs contact");
    expect(ganesh.offers!.length).toBeGreaterThan(0);
    expect(ganesh.offers!.every((o) => o.dayOffset > 0)).toBe(true);
  });

  it("chat (basic mode), Hindi and English", async () => {
    const id = await away();
    await sendChatMessage(KIRAN, "today after 12", TODAY_AFTER_12);
    await sendChatMessage(NIKHIL, "today after 12", TODAY_AFTER_12);
    await changeExpectedReturn(id, "14:00");
    await sendChatMessage(KIRAN, "A", PICK_A);
    await sendChatMessage(NIKHIL, "A", PICK_A);
    expect(
      (await lastChat(KIRAN)).startsWith(doctorBackLaterPrefix("Hindi", MEERA_NAMES.Hindi, "14:00")),
    ).toBe(true);
    expect(
      (await lastChat(NIKHIL)).startsWith(
        "Sorry, Dr. Meera Krishnan will now be back at 2:00 PM, so that time is no longer available. ",
      ),
    ).toBe(true);
  });

  it("WhatsApp: the same line", async () => {
    const id = await away();
    await sendWhatsAppMessage(NIKHIL, "today after 12");
    expect((await appt(NIKHIL)).offers![0]).toMatchObject({ dayOffset: 0, startTime: "12:30" });
    await changeExpectedReturn(id, "14:00");
    await sendWhatsAppMessage(NIKHIL, "A");
    const reply = await lastWhatsApp(NIKHIL);
    expect(
      reply.startsWith(
        "Sorry, Dr. Meera Krishnan will now be back at 2:00 PM, so that time is no longer available. ",
      ),
    ).toBe(true);
    expect(reply).not.toContain(slotTakenPrefix("English"));
    expect((await appt(NIKHIL)).status).toBe("Affected – needs contact");
  });

  it("WhatsApp, while changing an earlier answer: the same line, and the old booking is kept", async () => {
    const id = await away();
    await sendWhatsAppMessage(KIRAN, "2");
    await sendWhatsAppMessage(KIRAN, "A"); // booked on another day
    const booked = await appt(KIRAN);
    expect(booked.status).toBe("Rescheduled – another day");
    await sendWhatsAppMessage(KIRAN, "today after 12"); // wants to change: offered 12:30 …
    expect((await appt(KIRAN)).change!.offers![0]).toMatchObject({ dayOffset: 0, startTime: "12:30" });
    await changeExpectedReturn(id, "14:00");
    await sendWhatsAppMessage(KIRAN, "A");
    expect(
      (await lastWhatsApp(KIRAN)).startsWith(
        doctorBackLaterPrefix("Hindi", MEERA_NAMES.Hindi, "14:00"),
      ),
    ).toBe(true);
    const after = await appt(KIRAN);
    expect([after.status, after.dayOffset, after.startTime]).toEqual([
      booked.status,
      booked.dayOffset,
      booked.startTime,
    ]);
  });

  it("Buttons: the patient hears the new line first, and it's cleared once they pick again", async () => {
    const id = await away();
    await sendChatMessage(GANESH, "today after 12", TODAY_AFTER_12); // offers stay for Buttons too
    await changeExpectedReturn(id, "14:00");
    expect(await chooseOffer(GANESH, 0)).toBe("taken");

    const ganesh = await appt(GANESH);
    expect(ganesh.doctorBackLater).toEqual({ doctorId: MEERA, backAt: "14:00" });
    expect(ganesh.slotJustTaken).toBeUndefined();
    expect(ganesh.callLog!.at(-1)!.detail).toBe(
      "Picked A, but Dr. Meera Krishnan is now back at 2:00 PM",
    );
    expect(ganesh.offers!.every((o) => o.dayOffset > 0)).toBe(true); // fresh options: as before

    expect(await chooseOffer(GANESH, 0)).toBe("booked");
    expect((await appt(GANESH)).doctorBackLater).toBeUndefined();
  });

  it("Buttons, another doctor: names the doctor who is away (Dr. Karthik)", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants another doctor today"); // A = 9:30 with Dr. Karthik
    const karthik = await away(KARTHIK, "10:00");
    await changeExpectedReturn(karthik, "12:00");
    expect(await chooseOffer(NIKHIL, 0)).toBe("taken");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.doctorBackLater).toEqual({ doctorId: KARTHIK, backAt: "12:00" });
    expect(nikhil.slotJustTaken).toBeUndefined();
    expect(nikhil.offers!.map((o) => o.startTime)).toEqual(["13:15", "14:30", "15:45"]);
    // Pressing "None of these" clears it.
    await chooseOffer(NIKHIL, null);
    expect((await appt(NIKHIL)).doctorBackLater).toBeUndefined();
  });

  it("chat, another doctor: the line names Dr. Karthik and his return time", async () => {
    await away();
    await sendChatMessage(NIKHIL, "another doctor", { intent: "another_doctor", preferences: {} });
    const karthik = await away(KARTHIK, "10:00");
    await changeExpectedReturn(karthik, "12:00");
    await sendChatMessage(NIKHIL, "A", PICK_A);
    expect(
      (await lastChat(NIKHIL)).startsWith(
        "Sorry, Dr. Karthik Raman will now be back at 12:00 PM, so that time is no longer available. ",
      ),
    ).toBe(true);
  });

  it("AI mode: the tool gives the fixed line, and it goes in front of the AI's reply", async () => {
    const id = await away();
    await sendChatMessage(GANESH, "today after 12", TODAY_AFTER_12);
    await changeExpectedReturn(id, "14:00");
    const line = doctorBackLaterPrefix("Tamil", MEERA_NAMES.Tamil, "14:00");

    const turn = (await startAiTurn(GANESH))!;
    expect(turn.refusalLine()).toBeUndefined();
    const refused = turn.runTool("book_slot", { day_offset: 0, start_time: "12:30" });
    expect(refused.ok).toBe(false);
    expect(refused.docdelay_says_first).toBe(line);
    expect(turn.refusalLine()).toBe(line);
    expect(turn.allowedTimes().has("14:00")).toBe(true);

    // The whole AI turn: the AI tries to book A, is refused, and offers again.
    script = (t) => {
      t.runTool("book_slot", { day_offset: 0, start_time: "12:30" });
      return "வேறு நாளில் நேரம் பார்க்கலாமா?";
    };
    expect((await aiChatTurn(GANESH, "A")).ok).toBe(true);
    expect(await lastChat(GANESH)).toBe(`${line} வேறு நாளில் நேரம் பார்க்கலாமா?`);
    expect((await appt(GANESH)).status).toBe("Affected – needs contact");
  });

  it("AI mode, another doctor: the same, naming Dr. Karthik", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants another doctor today"); // looking at 9:30 with Dr. Karthik
    const karthik = await away(KARTHIK, "10:00");
    await changeExpectedReturn(karthik, "12:00");
    const turn = (await startAiTurn(NIKHIL))!;
    const refused = turn.runTool("book_with_another_doctor", { start_time: "09:30" });
    expect(refused.ok).toBe(false);
    expect(refused.docdelay_says_first).toBe(
      "Sorry, Dr. Karthik Raman will now be back at 12:00 PM, so that time is no longer available.",
    );
    expect(turn.allowedTimes().has("12:00")).toBe(true);
  });
});

describe("refused because SOMEONE ELSE booked it → still “Sorry, that time was just taken”", () => {
  it("chat (basic mode)", async () => {
    await away();
    await sendChatMessage(GANESH, "today after 12", TODAY_AFTER_12);
    await sendChatMessage(KIRAN, "today after 12", TODAY_AFTER_12); // both offered 12:30
    await sendChatMessage(KIRAN, "A", PICK_A); // Kiran takes it
    await sendChatMessage(GANESH, "A", PICK_A);
    const reply = await lastChat(GANESH);
    expect(reply.startsWith(`${slotTakenPrefix("Tamil")} `)).toBe(true);
    expect(reply).not.toContain("திரும்பி வருவார்"); // nothing about the doctor's return
  });

  it("WhatsApp", async () => {
    await away();
    await sendWhatsAppMessage(NIKHIL, "today after 12");
    await sendChatMessage(GANESH, "today after 12", TODAY_AFTER_12);
    await sendChatMessage(GANESH, "A", PICK_A); // Ganesh takes 12:30
    await sendWhatsAppMessage(NIKHIL, "A");
    expect((await lastWhatsApp(NIKHIL)).startsWith("Sorry, that time was just taken. ")).toBe(true);
  });

  it("Buttons, another doctor: “just taken” as before, no return-time line", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants another doctor today");
    await recordCallResult(GANESH, "Wants another doctor today");
    expect(await chooseOffer(NIKHIL, 0)).toBe("booked"); // takes Dr. Karthik's 9:30
    expect(await chooseOffer(GANESH, 0)).toBe("taken");
    const ganesh = await appt(GANESH);
    expect(ganesh.slotJustTaken).toBe(true);
    expect(ganesh.doctorBackLater).toBeUndefined();
    expect(ganesh.callLog!.at(-1)!.detail).toBe("Picked A, but it was just taken");
  });

  it("Buttons, same doctor: unchanged (no return-time line)", async () => {
    await away();
    await sendChatMessage(GANESH, "today after 12", TODAY_AFTER_12);
    await sendChatMessage(KIRAN, "today after 12", TODAY_AFTER_12);
    await sendChatMessage(KIRAN, "A", PICK_A);
    expect(await chooseOffer(GANESH, 0)).toBe("taken");
    const ganesh = await appt(GANESH);
    expect(ganesh.doctorBackLater).toBeUndefined();
    expect(ganesh.slotJustTaken).toBeUndefined();
  });

  it("AI mode: the tool's answer is unchanged and no fixed line is added", async () => {
    await away();
    await sendChatMessage(GANESH, "today after 12", TODAY_AFTER_12);
    await sendChatMessage(KIRAN, "today after 12", TODAY_AFTER_12);
    await sendChatMessage(KIRAN, "A", PICK_A);
    const turn = (await startAiTurn(GANESH))!;
    const refused = turn.runTool("book_slot", { day_offset: 0, start_time: "12:30" });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe("That slot isn't free any more (or it's outside the rules).");
    expect(refused.docdelay_says_first).toBeUndefined();
    expect(turn.refusalLine()).toBeUndefined();
  });
});
