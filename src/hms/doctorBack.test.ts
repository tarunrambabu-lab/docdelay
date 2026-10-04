// Tests for step 1 of the waiting check: knowing when the doctor is back —
// run with: npm test.
//
// These run the real code in the fake HMS. As in the other hms tests, the
// only thing swapped out is where a visitor's demo history is kept.
//
// The mock hospital (mockData.json), Dr. Meera Krishnan (doc-cardio) today:
//   - booked 9:00–11:45 without a gap except 11:00 and 11:15 → 10 patients
//     (appt-001 … appt-010) are affected by an absence from 9:00 to 12:00;
//   - EMPTY slots: 11:00, 11:15, 12:30, 1:45, 2:00, 3:00, 3:45, 4:00, 4:15;
//   - booked 12:00, 12:15, 12:45, 1:00, 1:15, 1:30 (6 patients in "the extra
//     time" if her return moves from 12:00 to 2:00 PM).
// Dr. Karthik Raman (doc-cardio-2) covers for her; his EMPTY slots today:
//   9:30, 10:45, 11:30, 1:15, 2:30, 3:45, 4:30.
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

import {
  bookSlot,
  changeExpectedReturn,
  chooseOffer,
  getAnotherDoctorOptions,
  getAppointment,
  getAppointmentsForDay,
  getCallQueue,
  getInsideAbsence,
  getMessages,
  getPendingUpdates,
  getUnavailabilities,
  getUpdatesInsideAbsence,
  markDoctorAvailable,
  markDoctorUnavailable,
  recordCallResult,
  sendChatMessage,
  sendPendingUpdates,
  sendWhatsAppMessage,
  startAiTurn,
} from "@/hms/mockHms";
import { decodeStep, encodeStep } from "@/hms/visitorState";
import { bookingsStartAt } from "@/lib/returnCheck";

const MEERA = "doc-cardio";
const KARTHIK = "doc-cardio-2";
const AFFECTED = Array.from({ length: 10 }, (_, i) => `appt-${String(i + 1).padStart(3, "0")}`);
const NIKHIL = "appt-001"; // 9:00, English, WhatsApp OK
const GANESH = "appt-002"; // 9:15, not on WhatsApp
const KIRAN = "appt-003"; // 9:30, WhatsApp OK

// Mark a doctor unavailable 9:00–12:00 and return the absence's id.
// (An absence's id comes from the moment it was marked, so wait a moment
// first: two absences marked in the same millisecond would share an id.)
const away = async (doctorId = MEERA, fromTime = "09:00", untilTime = "12:00") => {
  await new Promise((resolve) => setTimeout(resolve, 3));
  return (await markDoctorUnavailable({ doctorId, reason: "Emergency surgery", fromTime, untilTime }))!
    .id;
};
const absence = async (id: string) => (await getUnavailabilities()).find((u) => u.id === id)!;
const appt = async (id: string) => (await getAppointment(id))!;
const meeraToday = () => getAppointmentsForDay(MEERA, 0);
// Everything about today's appointments that a patient would notice.
const snapshot = async () =>
  (await meeraToday()).map((a) => [a.id, a.status, a.dayOffset, a.startTime, a.doctorId].join());
const laterToday = (id: string) => recordCallResult(id, "Wants later today");

beforeEach(() => {
  steps = [];
});

describe("change expected return time", () => {
  it("a later time is saved, shown as the current time, and logged", async () => {
    const id = await away();
    expect(await changeExpectedReturn(id, "14:00")).toBe(true);
    const u = await absence(id);
    expect(u.untilTime).toBe("14:00");
    expect(u.returnTimeChanges).toHaveLength(1);
    expect(u.returnTimeChanges![0]).toMatchObject({ oldTime: "12:00", newTime: "14:00" });
  });

  it("every change is logged, earlier or later, and the first time is kept", async () => {
    const id = await away();
    expect(await changeExpectedReturn(id, "14:00")).toBe(true);
    expect(await changeExpectedReturn(id, "11:00")).toBe(true);
    expect(await changeExpectedReturn(id, "15:30")).toBe(true);
    const u = await absence(id);
    expect(u.returnTimeChanges!.map((c) => `${c.oldTime}>${c.newTime}`)).toEqual([
      "12:00>14:00",
      "14:00>11:00",
      "11:00>15:30",
    ]);
    expect(u.returnTimeChanges![0].oldTime).toBe("12:00");
    expect(u.untilTime).toBe("15:30");
  });

  it("the same time, a time not after the absence's start, or nonsense: nothing is saved", async () => {
    const id = await away();
    for (const time of ["12:00", "09:00", "08:30", "25:00", "soon", ""]) {
      expect(await changeExpectedReturn(id, time)).toBe(false);
    }
    expect(await changeExpectedReturn("unavail-0", "14:00")).toBe(false);
    const u = await absence(id);
    expect(u.untilTime).toBe("12:00");
    expect(u.returnTimeChanges).toBeUndefined();
    expect(steps).toHaveLength(1); // only "marked unavailable"
  });

  it("a LATER time moves nobody and sends nothing", async () => {
    const id = await away();
    await laterToday(NIKHIL); // one patient already rebooked
    const [before, pending] = [await snapshot(), await getPendingUpdates()];
    await changeExpectedReturn(id, "14:00");
    expect(await snapshot()).toEqual(before);
    expect(await getPendingUpdates()).toEqual(pending);
    expect(await getMessages()).toEqual([]);
    expect((await absence(id)).affectedCount).toBe(10);
    expect(await getCallQueue(id)).toHaveLength(9);
  });

  it("an EARLIER time moves nobody and sends nothing", async () => {
    const id = await away();
    await laterToday(NIKHIL);
    const [before, pending] = [await snapshot(), await getPendingUpdates()];
    await changeExpectedReturn(id, "10:00");
    expect(await snapshot()).toEqual(before);
    expect(await getPendingUpdates()).toEqual(pending);
    expect(await getMessages()).toEqual([]);
    expect(await getCallQueue(id)).toHaveLength(9);
  });

  it("the saved steps survive being written to the cookie and read back", () => {
    const changed: DemoStep = { kind: "returnTime", at: 1790000000000, absence: 0, untilTime: "14:00" };
    const available: DemoStep = { kind: "available", at: 1790000000001, absence: 1 };
    expect(decodeStep(encodeStep(changed))).toEqual(changed);
    expect(decodeStep(encodeStep(available))).toEqual(available);
    // Anything that doesn't look right is thrown away, never trusted.
    for (const bad of ["r.0.2500.abc", "r.-1.1400.abc", "r.x.1400.abc", "m.x.abc", "m.-1.abc", "r.0.1400"]) {
      expect(decodeStep(bad)).toBeNull();
    }
  });
});

describe("after a LATER time, no NEW booking lands inside the longer absence", () => {
  it("before any change, “later today” gives the first empty slot from 12:00 (12:30)", async () => {
    await away();
    await laterToday(NIKHIL);
    expect((await appt(NIKHIL)).startTime).toBe("12:30");
  });

  it("“1 – Later today” (Buttons): the first empty slot from 2:00 PM, not 12:30", async () => {
    const id = await away();
    await changeExpectedReturn(id, "14:00");
    await laterToday(NIKHIL);
    expect((await appt(NIKHIL)).startTime).toBe("14:00");
    await laterToday(GANESH);
    expect((await appt(GANESH)).startTime).toBe("15:00");
  });

  it("“I'll wait” in chat and on WhatsApp: from 2:00 PM too", async () => {
    const id = await away();
    await changeExpectedReturn(id, "14:00");
    await sendChatMessage(GANESH, "I'll wait", { intent: "later_today", preferences: {} });
    expect((await appt(GANESH)).startTime).toBe("14:00");
    await sendWhatsAppMessage(NIKHIL, "1");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Rescheduled – later today");
    expect(nikhil.startTime).toBe("15:00");
  });

  it("a chosen time today (“today after 12”) only offers times from 2:00 PM", async () => {
    const id = await away();
    await changeExpectedReturn(id, "14:00");
    await sendChatMessage(GANESH, "today after 12", {
      intent: "later_today",
      preferences: { dayOffset: 0, after: "12:00" },
    });
    const offers = (await appt(GANESH)).offers!;
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.dayOffset !== 0 || o.startTime >= "14:00")).toBe(true);
  });

  it("booking a slot directly: 12:30 and 1:45 PM are refused, 2:00 PM is booked", async () => {
    const id = await away();
    await changeExpectedReturn(id, "14:00");
    expect((await bookSlot(GANESH, { dayOffset: 0, startTime: "12:30" })).ok).toBe(false);
    expect((await bookSlot(GANESH, { dayOffset: 0, startTime: "13:45" })).ok).toBe(false);
    expect((await appt(GANESH)).status).toBe("Affected – needs contact");
    expect((await bookSlot(GANESH, { dayOffset: 0, startTime: "14:00" })).ok).toBe(true);
  });

  it("an offer shown BEFORE the change can't be picked afterwards", async () => {
    const id = await away();
    await sendChatMessage(GANESH, "today after 12", {
      intent: "later_today",
      preferences: { dayOffset: 0, after: "12:00" },
    });
    expect((await appt(GANESH)).offers![0]).toMatchObject({ dayOffset: 0, startTime: "12:30" });
    await changeExpectedReturn(id, "14:00");
    await sendChatMessage(GANESH, "A", {
      intent: "choose_offer",
      preferences: {},
      offerIndex: 0,
    });
    const ganesh = await appt(GANESH);
    expect(ganesh.dayOffset === 0 && ganesh.startTime < "14:00" && ganesh.startTime >= "12:00").toBe(
      false,
    );
    expect(ganesh.status).toBe("Affected – needs contact");
  });

  it("a WhatsApp change of answer: the new time today is from 2:00 PM", async () => {
    const id = await away();
    await sendWhatsAppMessage(NIKHIL, "2"); // another day…
    await sendWhatsAppMessage(NIKHIL, "A");
    expect((await appt(NIKHIL)).status).toBe("Rescheduled – another day");
    await changeExpectedReturn(id, "14:00");
    await sendWhatsAppMessage(NIKHIL, "I'll wait for a later time today"); // …changed to today
    const nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Rescheduled – later today");
    expect(nikhil.startTime).toBe("14:00");
  });

  it("the AI's tools: “wait” gives 2:00 PM, and it can't book 12:30", async () => {
    const id = await away();
    await changeExpectedReturn(id, "14:00");
    const turn = (await startAiTurn(GANESH))!;
    expect(turn.runTool("book_slot", { day_offset: 0, start_time: "12:30" }).ok).toBe(false);
    const today = turn.runTool("check_free_slots", { when: "today" }) as {
      slots: { day_offset: number; start_time: string }[];
    };
    expect(today.slots.every((s) => s.day_offset !== 0 || s.start_time >= "14:00")).toBe(true);
    expect(turn.runTool("wait_later_today", {}).ok).toBe(true);
    expect(await turn.save("I'll wait", "")).toBe(true);
    expect((await appt(GANESH)).startTime).toBe("14:00");
  });

  it("patients are told the new, later return time", async () => {
    const id = await away();
    await changeExpectedReturn(id, "14:00");
    await sendChatMessage(GANESH, "hello?", { intent: "unclear", preferences: {} });
    const opening = (await appt(GANESH)).chat![0].text;
    expect((await startAiTurn(KIRAN))!.context.doctorBackSay).toContain("2:00");
    expect(opening).not.toContain("12:00");
  });
});

describe("the doctor is back EARLY: nothing changes for patients", () => {
  it("an earlier time: “later today” still starts at the first expected time", async () => {
    const id = await away();
    await changeExpectedReturn(id, "10:00");
    expect(bookingsStartAt(await absence(id))).toBe("12:00");
    await laterToday(NIKHIL);
    expect((await appt(NIKHIL)).startTime).toBe("12:30"); // not the empty 11:00 or 11:15
  });

  it("an earlier time: the empty 11:00 slot can't be booked, by any path", async () => {
    const id = await away();
    await changeExpectedReturn(id, "10:00");
    expect((await bookSlot(GANESH, { dayOffset: 0, startTime: "11:00" })).ok).toBe(false);
    const turn = (await startAiTurn(GANESH))!;
    expect(turn.runTool("book_slot", { day_offset: 0, start_time: "11:15" }).ok).toBe(false);
    await sendChatMessage(GANESH, "today after 10", {
      intent: "later_today",
      preferences: { dayOffset: 0, after: "10:00" },
    });
    const offers = (await appt(GANESH)).offers!;
    expect(offers.every((o) => o.dayOffset !== 0 || o.startTime >= "12:00")).toBe(true);
  });

  it("nobody who answers later gets an earlier time than someone who answered first", async () => {
    const id = await away();
    await laterToday(NIKHIL); // answers first → 12:30
    await changeExpectedReturn(id, "10:00");
    await laterToday(GANESH); // answers after the earlier time was entered
    await markDoctorAvailable(id);
    await laterToday(KIRAN); // answers after the doctor was marked available
    const [first, second, third] = [await appt(NIKHIL), await appt(GANESH), await appt(KIRAN)];
    expect(first.startTime).toBe("12:30");
    expect(second.startTime > first.startTime).toBe(true);
    expect(third.startTime > second.startTime).toBe(true);
  });

  it("patients not yet reached stay in the call queue and are told the first expected time", async () => {
    const id = await away();
    await changeExpectedReturn(id, "10:00");
    expect((await getCallQueue(id)).map((a) => a.id)).toEqual(AFFECTED);
    await sendChatMessage(GANESH, "hello?", { intent: "unclear", preferences: {} });
    expect((await startAiTurn(KIRAN))!.context.doctorBackSay).toContain("12:00");
    expect((await appt(GANESH)).chat![0].text).not.toContain("10:00");
  });

  // The day is full once the 7 empty slots from 12:00 are used, so the 8th
  // "later today" answer runs the PUSH rule. Whatever the return time was
  // changed to, a push must never touch a patient DocDelay hasn't reached.
  for (const [label, newTime] of [
    ["an EARLIER time", "10:00"],
    ["a LATER time", "14:00"],
  ]) {
    it(`the push rule never moves patients not yet reached (after ${label})`, async () => {
      const id = await away();
      await changeExpectedReturn(id, newTime);
      const original = new Map((await meeraToday()).map((a) => [a.id, a.startTime]));
      for (const patient of AFFECTED) {
        await laterToday(patient);
        for (const a of await meeraToday()) {
          if (a.status !== "Affected – needs contact") continue;
          expect(a.startTime).toBe(original.get(a.id));
          expect(a.timeHistory).toBeUndefined();
        }
        const waiting = (await getCallQueue(id)).map((a) => a.id);
        const updates = (await getPendingUpdates()).map((u) => u.appointmentId);
        expect(updates.filter((u) => waiting.includes(u))).toEqual([]);
      }
      // The push rule did run (someone who wasn't affected was moved)…
      expect((await meeraToday()).some((a) => a.status === "Time moved")).toBe(true);
      // …and no new time today is before the time bookings start at.
      const start = bookingsStartAt(await absence(id));
      for (const a of await meeraToday()) {
        if (a.timeHistory?.length) expect(a.startTime >= start).toBe(true);
      }
    });
  }
});

describe("mark doctor available", () => {
  it("records when it was pressed and ends the absence", async () => {
    const id = await away();
    expect((await absence(id)).markedAvailableAt).toBeUndefined();
    expect(await markDoctorAvailable(id)).toBe(true);
    expect((await absence(id)).markedAvailableAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    // Pressing it again, or for an unknown absence, does nothing.
    expect(await markDoctorAvailable(id)).toBe(false);
    expect(await markDoctorAvailable("unavail-0")).toBe(false);
    expect(steps).toHaveLength(2);
  });

  it("nobody already rebooked or pushed is moved, and nothing is sent", async () => {
    const id = await away();
    for (const patient of AFFECTED.slice(0, 8)) await laterToday(patient); // includes a push
    const [before, pending] = [await snapshot(), await getPendingUpdates()];
    await markDoctorAvailable(id);
    expect(await snapshot()).toEqual(before);
    expect(await getPendingUpdates()).toEqual(pending);
    expect(await getMessages()).toEqual([]);
    expect(await getCallQueue(id)).toHaveLength(2);
  });

  it("the expected time can't be changed afterwards", async () => {
    const id = await away();
    await markDoctorAvailable(id);
    expect(await changeExpectedReturn(id, "14:00")).toBe(false);
    expect((await absence(id)).untilTime).toBe("12:00");
  });

  it("pressed early: the booking rules don't change", async () => {
    const id = await away();
    await markDoctorAvailable(id);
    await laterToday(NIKHIL);
    expect((await appt(NIKHIL)).startTime).toBe("12:30");
    expect((await bookSlot(GANESH, { dayOffset: 0, startTime: "11:00" })).ok).toBe(false);
  });

  it("after a later time: bookings keep starting at that later time", async () => {
    const id = await away();
    await changeExpectedReturn(id, "14:00");
    await markDoctorAvailable(id);
    await laterToday(NIKHIL);
    expect((await appt(NIKHIL)).startTime).toBe("14:00");
  });
});

describe("the “not contacted yet” list (times inside the longer absence)", () => {
  const rows = async (id: string) =>
    (await getInsideAbsence(id)).map((r) => `${r.time} ${r.group}${r.unsentUpdate ? " ⚠" : ""}`);

  it("is empty until a later time is entered, and after an earlier time", async () => {
    const id = await away();
    await laterToday(NIKHIL);
    expect(await rows(id)).toEqual([]);
    await changeExpectedReturn(id, "10:00");
    expect(await rows(id)).toEqual([]);
  });

  it("a later time lists the 6 patients booked in the extra time", async () => {
    const id = await away();
    await changeExpectedReturn(id, "14:00");
    expect(await rows(id)).toEqual([
      "12:00 Never contacted",
      "12:15 Never contacted",
      "12:45 Never contacted",
      "13:00 Never contacted",
      "13:15 Never contacted",
      "13:30 Never contacted",
    ]);
    // Listing is all that happens: they are not marked as affected.
    for (const row of await getInsideAbsence(id)) {
      expect(row.appointment.status).toBe("Scheduled");
      expect(row.appointment.unavailabilityId).toBeUndefined();
    }
  });

  it("also lists patients DocDelay already rebooked into the extra time, and their unsent update", async () => {
    const id = await away();
    await laterToday(NIKHIL); // → 12:30
    await laterToday(GANESH); // → 1:45 PM
    await changeExpectedReturn(id, "14:00");
    expect(await rows(id)).toContain("12:30 Rebooked by DocDelay ⚠");
    expect(await rows(id)).toContain("13:45 Rebooked by DocDelay ⚠");
    expect((await getUpdatesInsideAbsence()).sort()).toEqual([NIKHIL, GANESH]);
    // Once the updates are sent, the patients stay listed but nothing is "unsent".
    await sendPendingUpdates();
    expect(await rows(id)).toContain("12:30 Rebooked by DocDelay");
    expect(await getUpdatesInsideAbsence()).toEqual([]);
  });

  it("lists pushed patients whose new time is inside the extra time", async () => {
    const id = await away();
    for (const patient of AFFECTED.slice(0, 8)) await laterToday(patient); // the 8th pushes
    expect(await getUpdatesInsideAbsence()).toEqual([]); // no later time yet → no warning
    await changeExpectedReturn(id, "16:30");
    const list = await getInsideAbsence(id);
    expect(list.some((r) => r.group === "Pushed by DocDelay")).toBe(true);
    expect(list.every((r) => r.time >= "12:00" && r.time < "16:30")).toBe(true);
    expect((await getUpdatesInsideAbsence()).length).toBeGreaterThan(0);
  });

  it("lists a patient who is looking at an offer inside the extra time", async () => {
    const id = await away();
    await sendChatMessage(GANESH, "today after 12", {
      intent: "later_today",
      preferences: { dayOffset: 0, after: "12:00" },
    });
    await changeExpectedReturn(id, "14:00");
    expect(await rows(id)).toContain("12:30 Choosing a time");
  });

  it("is empty again once the doctor is marked available", async () => {
    const id = await away();
    await laterToday(NIKHIL);
    await changeExpectedReturn(id, "14:00");
    expect((await rows(id)).length).toBeGreaterThan(0);
    await markDoctorAvailable(id);
    expect(await rows(id)).toEqual([]);
    expect(await getUpdatesInsideAbsence()).toEqual([]);
  });
});

describe("another doctor today: never during the covering doctor's own absence", () => {
  const times = (offers: { startTime: string }[]) => offers.map((o) => o.startTime);

  it("Dr. Karthik's slots inside his own absence aren't offered", async () => {
    await away();
    expect(times(await getAnotherDoctorOptions(NIKHIL))).toEqual(["09:30", "10:45", "11:30"]);
    await away(KARTHIK, "09:00", "11:00");
    expect(times(await getAnotherDoctorOptions(NIKHIL))).toEqual(["11:30", "13:15", "14:30"]);
  });

  it("a later return time for Dr. Karthik removes more of his slots", async () => {
    await away();
    const karthik = await away(KARTHIK, "09:00", "11:00");
    await changeExpectedReturn(karthik, "14:00");
    const offers = await getAnotherDoctorOptions(NIKHIL);
    expect(times(offers)).toEqual(["14:30", "15:45", "16:30"]);
    expect(offers.every((o) => o.doctorId === KARTHIK)).toBe(true);
  });

  it("an earlier time, or marking him available early, doesn't open his slots again", async () => {
    await away();
    const karthik = await away(KARTHIK, "09:00", "12:00");
    await changeExpectedReturn(karthik, "10:00");
    expect(times(await getAnotherDoctorOptions(NIKHIL))).toEqual(["13:15", "14:30", "15:45"]);
    await markDoctorAvailable(karthik);
    expect(times(await getAnotherDoctorOptions(NIKHIL))).toEqual(["13:15", "14:30", "15:45"]);
  });

  it("an offer shown before Dr. Karthik went away can't be picked afterwards (Buttons)", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants another doctor today"); // A = 9:30 with Dr. Karthik
    expect((await appt(NIKHIL)).offers![0]).toMatchObject({ startTime: "09:30", doctorId: KARTHIK });
    await away(KARTHIK, "09:00", "12:00");
    expect(await chooseOffer(NIKHIL, 0)).toBe("taken");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.doctorId).toBe(MEERA);
    expect(nikhil.status).toBe("Affected – needs contact");
    // The fresh offers are all after his return.
    expect(times(nikhil.offers!)).toEqual(["13:15", "14:30", "15:45"]);
  });

  it("the AI can't book with Dr. Karthik during his absence either", async () => {
    await away();
    await away(KARTHIK, "09:00", "12:00");
    const turn = (await startAiTurn(NIKHIL))!;
    const found = turn.runTool("check_another_doctor_slots", {}) as {
      slots: { start_time: string }[];
    };
    expect(found.slots.map((s) => s.start_time)).toEqual(["13:15", "14:30", "15:45"]);
    expect(turn.runTool("book_with_another_doctor", { start_time: "10:45" }).ok).toBe(false);
    expect(turn.runTool("book_with_another_doctor", { start_time: "13:15" }).ok).toBe(true);
  });

  it("with nobody away but Dr. Meera, the offers are exactly as before", async () => {
    await away();
    expect(times(await getAnotherDoctorOptions("appt-010"))).toEqual(["13:15", "14:30", "15:45"]);
  });
});
