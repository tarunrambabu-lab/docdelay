// Tests for the clock fix — run with: npm test.
//   1. Each visitor's demo has its own "time now" (starts 9:00 AM, forward only).
//   2. "Not before now": no path offers or books a time today that has passed.
//
// These run the real code in the fake HMS. NO real AI is called.
//
// The mock hospital (mockData.json), Dr. Meera Krishnan (doc-cardio) today:
//   - 10 patients (appt-001 … appt-010) are booked 9:00–11:45;
//   - EMPTY slots: 11:00, 11:15, 12:30, 1:45, 2:00, 3:00, 3:45, 4:00, 4:15.
// Dr. Karthik Raman (doc-cardio-2) covers for her; his EMPTY slots today:
//   9:30, 10:45, 11:30, 1:15, 2:30, 3:45, 4:30.
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

import { DEMO_TIME_CHOICES, isTimePassed } from "@/app/demoTimes";
import {
  bookSlot,
  changeExpectedReturn,
  checkFreeSlots,
  chooseOffer,
  getAnotherDoctorOptions,
  getAppointment,
  getAppointmentsForDay,
  getMessages,
  getPendingUpdates,
  getTimeNow,
  getUnavailabilities,
  markDoctorUnavailable,
  recordCallResult,
  resetDemo,
  sendChatMessage,
  sendPendingUpdates,
  sendWhatsAppMessage,
  setDemoTime,
  startAiTurn,
} from "@/hms/mockHms";
import { decodeStep, encodeStep } from "@/hms/visitorState";
import { doctorBackLaterPrefix, slotTakenPrefix, timePassedPrefix } from "@/lib/chatReplies";
import { CLOCK_MODE } from "@/lib/clock";
import { isReturnCheckDue } from "@/lib/returnCheck";
import { formatClock } from "@/lib/time";
import { aiChatTurn } from "@/lib/understanding/aiChat";
import { aiContext } from "@/lib/understanding/aiInstructions";
import type { Understanding } from "@/lib/understanding/types";

const MEERA = "doc-cardio";
const KARTHIK = "doc-cardio-2";
const AFFECTED = Array.from({ length: 10 }, (_, i) => `appt-${String(i + 1).padStart(3, "0")}`);
const NIKHIL = "appt-001"; // 9:00, English, WhatsApp OK
const GANESH = "appt-002"; // 9:15, Tamil, not on WhatsApp
const KIRAN = "appt-003"; // 9:30, Hindi, WhatsApp OK

const away = async (doctorId = MEERA, untilTime = "12:00") => {
  await new Promise((resolve) => setTimeout(resolve, 3)); // (absence ids come from the moment)
  return (await markDoctorUnavailable({
    doctorId,
    reason: "Emergency surgery",
    fromTime: "09:00",
    untilTime,
  }))!.id;
};
const appt = async (id: string) => (await getAppointment(id))!;
const meeraToday = () => getAppointmentsForDay(MEERA, 0);
const snapshot = async () =>
  (await meeraToday()).map((a) => [a.id, a.status, a.dayOffset, a.startTime, a.doctorId].join());
const laterToday = (id: string) => recordCallResult(id, "Wants later today");
const todayAfter = (after: string): Understanding => ({
  intent: "later_today",
  preferences: { dayOffset: 0, after },
});
const PICK_A: Understanding = { intent: "choose_offer", preferences: {}, offerIndex: 0 };
const lastChat = async (id: string) => (await appt(id)).chat!.at(-1)!.text;
const lastWhatsApp = async (id: string) => (await appt(id)).whatsapp!.at(-1)!.text;

beforeEach(() => {
  steps = [];
  vi.spyOn(console, "log").mockImplementation(() => {}); // quiet AI cost lines
});

describe("the demo's own time now", () => {
  it("is still the demo clock, and starts at 9:00 AM", async () => {
    expect(CLOCK_MODE).toBe("demo");
    expect(await getTimeNow()).toBe("09:00");
  });

  it("moves forward when the visitor picks a later time", async () => {
    expect(await setDemoTime("13:00")).toBe(true);
    expect(await getTimeNow()).toBe("13:00");
    expect(await setDemoTime("13:15")).toBe(true);
    expect(await getTimeNow()).toBe("13:15");
  });

  it("never goes backwards, and refuses anything that isn't a quarter hour from 9:00 AM to 5:00 PM", async () => {
    await setDemoTime("13:00");
    for (const time of ["10:00", "12:45", "13:00", "13:10", "17:15", "23:00", "soon", ""]) {
      expect(await setDemoTime(time), time).toBe(false);
    }
    expect(await getTimeNow()).toBe("13:00");
    expect(await setDemoTime("17:00")).toBe(true); // the last choice
  });

  it("“Reset demo” puts it back to 9:00 AM", async () => {
    await setDemoTime("15:30");
    await resetDemo();
    expect(await getTimeNow()).toBe("09:00");
  });

  it("several changes in a row keep only the last one; a change after another step is kept", async () => {
    await setDemoTime("10:00");
    await setDemoTime("11:00");
    await setDemoTime("12:15");
    expect(steps).toHaveLength(1);
    await away();
    await setDemoTime("13:00");
    expect(steps.map((s) => s.kind)).toEqual(["time", "unavailable", "time"]);
    expect(await getTimeNow()).toBe("13:00");
  });

  it("the saved step survives being written to the cookie and read back", () => {
    const step: DemoStep = { kind: "time", at: 1790000000000, time: "13:15" };
    expect(decodeStep(encodeStep(step))).toEqual(step);
    for (const bad of ["t.2500.abc", "t.abc", "t.13.15.abc"]) expect(decodeStep(bad)).toBeNull();
  });

  it("moving the time moves nobody and sends nothing", async () => {
    await away();
    await laterToday(NIKHIL);
    const [before, pending] = [await snapshot(), await getPendingUpdates()];
    await setDemoTime("15:00");
    expect(await snapshot()).toEqual(before);
    expect(await getPendingUpdates()).toEqual(pending);
    expect(await getMessages()).toEqual([]);
  });

  it("the picker offers every quarter hour from 9:00 AM to 5:00 PM (33 choices)", () => {
    expect(DEMO_TIME_CHOICES).toHaveLength(33);
    expect(DEMO_TIME_CHOICES[0]).toBe("09:00");
    expect(DEMO_TIME_CHOICES[1]).toBe("09:15");
    expect(DEMO_TIME_CHOICES.at(-1)).toBe("17:00");
  });

  it("a rebuilt demo gives every step the time it really happened at", async () => {
    await away();
    await laterToday(NIKHIL); // at 9:00 AM → 12:30
    await setDemoTime("13:00");
    await laterToday(GANESH); // at 1:00 PM → 1:45 PM
    // (Every read rebuilds the demo from its steps.)
    expect((await appt(NIKHIL)).startTime).toBe("12:30");
    expect((await appt(GANESH)).startTime).toBe("13:45");
    // Logs show the demo time each thing happened at.
    expect(formatClock((await appt(NIKHIL)).callLog![0].calledAt)).toBe("9:00 AM");
    expect(formatClock((await appt(GANESH)).callLog![0].calledAt)).toBe("1:00 PM");
    expect(formatClock((await appt(GANESH)).timeHistory![0].changedAt)).toBe("1:00 PM");
    await setDemoTime("14:30");
    await sendPendingUpdates();
    expect((await getMessages()).every((m) => formatClock(m.sentAt) === "2:30 PM")).toBe(true);
    expect(formatClock((await appt(NIKHIL)).callLog![0].calledAt)).toBe("9:00 AM"); // unchanged
  });
});

describe("staff screens that follow the time now", () => {
  it("the “Is the doctor back?” check comes up by itself once the demo time reaches the expected return", async () => {
    const id = await away();
    const absence = async () => (await getUnavailabilities()).find((u) => u.id === id)!;
    expect(isReturnCheckDue(await absence(), await getTimeNow())).toBe(false);
    await setDemoTime("11:45");
    expect(isReturnCheckDue(await absence(), await getTimeNow())).toBe(false);
    await setDemoTime("12:00");
    expect(isReturnCheckDue(await absence(), await getTimeNow())).toBe(true);
    // "Still away: 2:00 PM" → not due again until 2:00 PM.
    await changeExpectedReturn(id, "14:00");
    expect(isReturnCheckDue(await absence(), await getTimeNow())).toBe(false);
    await setDemoTime("14:00");
    expect(isReturnCheckDue(await absence(), await getTimeNow())).toBe(true);
  });

  it("“Time passed”: today's appointments before now — not one starting exactly now, not cancelled, not other days", () => {
    const at = (startTime: string, status = "Scheduled", dayOffset = 0) => ({
      startTime,
      status,
      dayOffset,
    });
    expect(isTimePassed(at("09:00"), "09:00")).toBe(false);
    expect(isTimePassed(at("09:00"), "09:15")).toBe(true);
    expect(isTimePassed(at("12:45", "Affected – needs contact"), "13:00")).toBe(true);
    expect(isTimePassed(at("13:00"), "13:00")).toBe(false);
    expect(isTimePassed(at("09:00", "Cancelled"), "13:00")).toBe(false);
    expect(isTimePassed(at("09:00", "Scheduled", 1), "13:00")).toBe(false);
  });
});

describe("not before now: nothing today is offered or booked before the time now", () => {
  it("“1 – Later today” (Buttons): the first empty slot from now, not 12:30", async () => {
    await away();
    await setDemoTime("13:00");
    await laterToday(NIKHIL);
    expect((await appt(NIKHIL)).startTime).toBe("13:45");
  });

  it("“I'll wait” in chat and on WhatsApp", async () => {
    await away();
    await setDemoTime("14:15");
    await sendChatMessage(GANESH, "I'll wait", { intent: "later_today", preferences: {} });
    expect((await appt(GANESH)).startTime).toBe("15:00");
    await sendWhatsAppMessage(NIKHIL, "1");
    expect((await appt(NIKHIL)).startTime).toBe("15:45");
  });

  it("a slot that starts exactly now can still be booked", async () => {
    await away();
    await setDemoTime("13:45");
    await laterToday(NIKHIL);
    expect((await appt(NIKHIL)).startTime).toBe("13:45");
  });

  it("a chosen time today: “today after 12” at 1:00 PM offers only times from 1:00 PM", async () => {
    await away();
    await setDemoTime("13:00");
    await sendChatMessage(GANESH, "today after 12", todayAfter("12:00"));
    const offers = (await appt(GANESH)).offers!;
    expect(offers.map((o) => o.startTime)).toEqual(["13:45", "14:00", "15:00"]);
    expect(offers.every((o) => o.dayOffset === 0)).toBe(true);
  });

  it("a wish that is wholly in the past today (“before 12:45” at 1:00 PM) gets other days, never a passed time", async () => {
    await away();
    await setDemoTime("13:00");
    await sendChatMessage(GANESH, "today before 12:45", {
      intent: "later_today",
      preferences: { dayOffset: 0, before: "12:45" },
    });
    const ganesh = await appt(GANESH);
    expect(ganesh.status).toBe("Affected – needs contact");
    expect((ganesh.offers ?? []).every((o) => o.dayOffset > 0)).toBe(true);
  });

  it("booking a slot directly: a passed time is refused, a later one is booked", async () => {
    await away();
    await setDemoTime("13:00");
    expect((await bookSlot(GANESH, { dayOffset: 0, startTime: "12:30" })).ok).toBe(false);
    expect((await appt(GANESH)).status).toBe("Affected – needs contact");
    expect((await bookSlot(GANESH, { dayOffset: 0, startTime: "13:45" })).ok).toBe(true);
  });

  it("the free-slot tool never lists a passed time today", async () => {
    await setDemoTime("13:00");
    const today = await checkFreeSlots(MEERA, { days: [0] }, { todayFrom: "09:00" });
    expect(today.map((s) => s.startTime)).toEqual(["13:45", "14:00", "15:00", "15:45", "16:00", "16:15"]);
  });

  it("a WhatsApp change of answer: the new time today is from now", async () => {
    await away();
    await sendWhatsAppMessage(NIKHIL, "2");
    await sendWhatsAppMessage(NIKHIL, "A"); // another day
    await setDemoTime("14:15");
    await sendWhatsAppMessage(NIKHIL, "I'll wait for a later time today");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Rescheduled – later today");
    expect(nikhil.startTime).toBe("15:00");
  });

  it("the AI's tools: “wait” gives a time from now, and it can't book a passed time", async () => {
    await away();
    await setDemoTime("13:00");
    const turn = (await startAiTurn(GANESH))!;
    const today = turn.runTool("check_free_slots", { when: "today" }) as {
      slots: { day_offset: number; start_time: string }[];
    };
    expect(today.slots.every((s) => s.day_offset !== 0 || s.start_time >= "13:00")).toBe(true);
    expect(turn.runTool("book_slot", { day_offset: 0, start_time: "12:30" }).ok).toBe(false);
    expect(turn.runTool("wait_later_today", {}).ok).toBe(true);
    expect(await turn.save("I'll wait", "")).toBe(true);
    expect((await appt(GANESH)).startTime).toBe("13:45");
  });

  it("the latest of the doctor's return and now: a later return still wins", async () => {
    const id = await away();
    await changeExpectedReturn(id, "15:00");
    await setDemoTime("13:00");
    await laterToday(NIKHIL);
    expect((await appt(NIKHIL)).startTime).toBe("15:00");
  });

  it("late in the day: nothing today is before now (5:00 PM → pushed after 5, or other days)", async () => {
    await away();
    await setDemoTime("17:00");
    await laterToday(NIKHIL);
    const nikhil = await appt(NIKHIL);
    if (nikhil.status === "Rescheduled – later today") expect(nikhil.startTime >= "17:00").toBe(true);
    else expect((nikhil.offers ?? []).every((o) => o.dayOffset > 0)).toBe(true);
  });

  // Once the empty slots are used, "later today" answers run the PUSH rule.
  it("the push rule never moves a patient whose time has already passed", async () => {
    await away();
    await setDemoTime("13:00");
    const before = new Map((await meeraToday()).map((a) => [a.id, a.startTime]));
    for (const patient of AFFECTED) await laterToday(patient);
    const after = await meeraToday();
    expect(after.some((a) => a.status === "Time moved")).toBe(true); // the push did run
    for (const a of after) {
      // Nobody who was booked before 1:00 PM (and isn't one of the 10 answering) moved.
      if (before.get(a.id)! < "13:00" && !AFFECTED.includes(a.id)) {
        expect(a.startTime).toBe(before.get(a.id));
      }
      // Every new time today is at or after 1:00 PM.
      if (a.timeHistory?.length && a.dayOffset === 0) expect(a.startTime >= "13:00").toBe(true);
    }
  });

  it("other days are not affected by the time now", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants another day");
    const atNine = (await appt(NIKHIL)).offers;
    steps = [];
    await away();
    await setDemoTime("16:00");
    await recordCallResult(NIKHIL, "Wants another day");
    expect((await appt(NIKHIL)).offers).toEqual(atNine);
    expect(atNine!.every((o) => o.dayOffset > 0)).toBe(true);
  });
});

describe("another doctor today: never before now", () => {
  const times = (offers: { startTime: string }[]) => offers.map((o) => o.startTime);

  it("offers start at the later of the patient's original time and now", async () => {
    await away();
    expect(times(await getAnotherDoctorOptions(NIKHIL))).toEqual(["09:30", "10:45", "11:30"]);
    await setDemoTime("10:00");
    expect(times(await getAnotherDoctorOptions(NIKHIL))).toEqual(["10:45", "11:30", "13:15"]);
    await setDemoTime("12:00");
    expect(times(await getAnotherDoctorOptions(NIKHIL))).toEqual(["13:15", "14:30", "15:45"]);
    // A patient booked later than now is still offered from their own time.
    expect(times(await getAnotherDoctorOptions("appt-010"))).toEqual(["13:15", "14:30", "15:45"]);
  });

  it("an offer shown earlier can't be picked once its time has passed (Buttons): “already passed”", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants another doctor today"); // A = 9:30 with Dr. Karthik
    await setDemoTime("10:00");
    expect(await chooseOffer(NIKHIL, 0)).toBe("taken");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.doctorId).toBe(MEERA);
    expect(nikhil.timePassed).toBe(true);
    expect(nikhil.slotJustTaken).toBeUndefined();
    expect(nikhil.doctorBackLater).toBeUndefined();
    expect(nikhil.callLog!.at(-1)!.detail).toBe("Picked A, but that time had already passed");
    expect(times(nikhil.offers!)).toEqual(["10:45", "11:30", "13:15"]);
    // Picking a fresh one books it and clears the line.
    expect(await chooseOffer(NIKHIL, 0)).toBe("booked");
    expect((await appt(NIKHIL)).timePassed).toBeUndefined();
  });

  it("the AI can't book another doctor's passed time either, and DocDelay says why", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants another doctor today");
    await setDemoTime("10:00");
    const turn = (await startAiTurn(NIKHIL))!;
    const refused = turn.runTool("book_with_another_doctor", { start_time: "09:30" });
    expect(refused.ok).toBe(false);
    expect(refused.docdelay_says_first).toBe("Sorry, that time has already passed.");
    expect(turn.runTool("book_with_another_doctor", { start_time: "10:45" }).ok).toBe(true);
  });

  it("a covering doctor's own absence still counts (Dr. Karthik away until 11:00, now 10:00)", async () => {
    await away();
    await away(KARTHIK, "11:00");
    await setDemoTime("10:00");
    expect(times(await getAnotherDoctorOptions(NIKHIL))).toEqual(["11:30", "13:15", "14:30"]);
  });
});

describe("a picked offer whose time has passed → “Sorry, that time has already passed.”", () => {
  it("the line in three languages", () => {
    expect(timePassedPrefix("English")).toBe("Sorry, that time has already passed.");
    for (const language of ["Tamil", "Hindi"] as const) {
      expect(timePassedPrefix(language)).not.toBe(slotTakenPrefix(language));
      expect(timePassedPrefix(language).length).toBeGreaterThan(10);
    }
  });

  it("chat (basic mode), Tamil: the line, then the same kind of fresh options as before", async () => {
    await away();
    await sendChatMessage(GANESH, "today after 12", todayAfter("12:00")); // offered 12:30 …
    await setDemoTime("13:00");
    await sendChatMessage(GANESH, "A", PICK_A);
    const reply = await lastChat(GANESH);
    expect(reply.startsWith(`${timePassedPrefix("Tamil")} `)).toBe(true);
    expect(reply).not.toContain(slotTakenPrefix("Tamil"));
    const ganesh = await appt(GANESH);
    expect(ganesh.status).toBe("Affected – needs contact");
    expect(ganesh.offers!.every((o) => o.dayOffset > 0)).toBe(true);
  });

  it("WhatsApp (Hindi and English)", async () => {
    await away();
    await sendWhatsAppMessage(KIRAN, "today after 12");
    await sendWhatsAppMessage(NIKHIL, "today after 12");
    await setDemoTime("13:00");
    await sendWhatsAppMessage(KIRAN, "A");
    await sendWhatsAppMessage(NIKHIL, "A");
    expect((await lastWhatsApp(KIRAN)).startsWith(`${timePassedPrefix("Hindi")} `)).toBe(true);
    expect((await lastWhatsApp(NIKHIL)).startsWith("Sorry, that time has already passed. ")).toBe(true);
  });

  it("Buttons, same doctor: heard first, logged, and cleared after the next pick", async () => {
    await away();
    await sendChatMessage(GANESH, "today after 12", todayAfter("12:00"));
    await setDemoTime("13:00");
    expect(await chooseOffer(GANESH, 0)).toBe("taken");
    const ganesh = await appt(GANESH);
    expect(ganesh.timePassed).toBe(true);
    expect(ganesh.callLog!.at(-1)!.detail).toBe("Picked A, but that time had already passed");
    expect(await chooseOffer(GANESH, 0)).toBe("booked");
    expect((await appt(GANESH)).timePassed).toBeUndefined();
  });

  it("AI mode: DocDelay's fixed line goes in front of the AI's reply", async () => {
    await away();
    await sendChatMessage(GANESH, "today after 12", todayAfter("12:00"));
    await setDemoTime("13:00");
    script = (t) => {
      t.runTool("book_slot", { day_offset: 0, start_time: "12:30" });
      return "வேறு நேரம் பார்க்கலாமா?";
    };
    expect((await aiChatTurn(GANESH, "A")).ok).toBe(true);
    expect(await lastChat(GANESH)).toBe(`${timePassedPrefix("Tamil")} வேறு நேரம் பார்க்கலாமா?`);
  });

  it("the doctor being back later still wins: that line names the doctor's return, not now", async () => {
    const id = await away();
    await sendChatMessage(NIKHIL, "today after 12", todayAfter("12:00")); // offered 12:30
    await changeExpectedReturn(id, "14:00");
    await setDemoTime("13:00");
    await sendChatMessage(NIKHIL, "A", PICK_A);
    expect(
      (await lastChat(NIKHIL)).startsWith(
        doctorBackLaterPrefix("English", "Dr. Meera Krishnan", "14:00"),
      ),
    ).toBe(true);
  });

  it("someone else booked it (and it hasn't passed): still “Sorry, that time was just taken.”", async () => {
    await away();
    await setDemoTime("13:00");
    await sendChatMessage(NIKHIL, "today after 12", todayAfter("12:00")); // both offered 1:45 PM
    await sendChatMessage(KIRAN, "today after 12", todayAfter("12:00"));
    await sendChatMessage(KIRAN, "A", PICK_A);
    await sendChatMessage(NIKHIL, "A", PICK_A);
    expect((await lastChat(NIKHIL)).startsWith("Sorry, that time was just taken. ")).toBe(true);
  });
});

describe("what patients and the AI are told", () => {
  it("patients are told when the DOCTOR is back, not “now”", async () => {
    await away();
    await setDemoTime("13:00");
    await sendChatMessage(NIKHIL, "hello?", { intent: "unclear", preferences: {} });
    const opening = (await appt(NIKHIL)).chat![0].text;
    expect(opening).toContain("12:00 PM");
    expect(opening).not.toContain("1:00 PM");
  });

  it("the AI is told the doctor's return AND the time now, and may mention it", async () => {
    await away();
    await setDemoTime("13:00");
    const turn = (await startAiTurn(NIKHIL))!;
    expect(turn.context.doctorBackSay).toBe("12:00 PM");
    expect(turn.context.timeNowSay).toBe("1:00 PM");
    expect(aiContext(turn.context)).toContain("- Time now at the hospital (write exactly): 1:00 PM");
    expect(turn.allowedTimes().has("13:00")).toBe(true);
  });
});
