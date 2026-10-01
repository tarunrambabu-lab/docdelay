// Tests for the simulated WhatsApp channel (Part 1: data and booking rules) —
// run with: npm test.
//
// These run the real code in the fake HMS. As in the other hms tests, the
// only thing swapped out is where a visitor's demo history is kept.
//
// The mock hospital (mockData.json): Dr. Meera Krishnan (doc-cardio) is away
// 9:00 AM – 12:00 PM, which affects appt-001 … appt-010. Her EMPTY slots after
// 12:00 are 12:30, 1:45, 2:00, 3:00, 3:45, 4:00 and 4:15 (seven of them).
// Patients with an odd number (pat-001, pat-003, …) are "WhatsApp OK";
// pat-007, pat-009 and pat-013 are also "WhatsApp fails".
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

import startingData from "@/hms/mockData.json";
import {
  chooseOffer,
  getAppointment,
  getAppointmentsForDay,
  getCallQueue,
  getMessages,
  getPendingUpdates,
  getStaffCallList,
  getUnavailabilities,
  markDoctorUnavailable,
  markFalseAlarm,
  MAX_ANSWER_CHANGES,
  recordCallResult,
  sendWhatsAppMessage,
  sendPendingUpdates,
} from "@/hms/mockHms";
import type { Patient } from "@/hms/types";
import { decodeStep, encodeStep } from "@/hms/visitorState";
import { changeMenuReply, emergencyOnlyReply, urgentReply } from "@/lib/chatReplies";
import { laterTodayReply } from "@/lib/callScript";

const MEERA = "doc-cardio";
const KARTHIK = "doc-cardio-2";

// Patients used below (see the note at the top).
const NIKHIL = "appt-001"; // English, WhatsApp OK
const GANESH = "appt-002"; // Tamil, NOT on WhatsApp
const KIRAN = "appt-003"; // Hindi, WhatsApp OK
const REVATHI = "appt-005"; // Tamil, WhatsApp OK
const DIVYA = "appt-007"; // English, WhatsApp OK but WhatsApp FAILS

const away = () =>
  markDoctorUnavailable({
    doctorId: MEERA,
    reason: "Emergency surgery",
    fromTime: "09:00",
    untilTime: "12:00",
  });
const appt = async (id: string) => (await getAppointment(id))!;
const whatsapp = sendWhatsAppMessage;
const meeraToday = async () =>
  (await getAppointmentsForDay(MEERA, 0)).filter((a) => a.status !== "Cancelled");
const timesToday = async () => (await meeraToday()).map((a) => a.startTime);

// Seven patients take Dr. Meera's seven empty slots; then Revathi (WhatsApp OK)
// answers "later today" on a call and is PUSHED in at 12:00 — everyone from
// 12:00 on moves back 15 minutes.
async function fillTodayThenPushRevathiIn() {
  await away();
  for (const id of ["appt-002", "appt-004", "appt-006", "appt-008", "appt-010", NIKHIL, KIRAN]) {
    expect(await recordCallResult(id, "Wants later today")).toBe(true);
  }
  expect(await recordCallResult(REVATHI, "Wants later today")).toBe(true);
  expect((await appt(REVATHI)).startTime).toBe("12:00");
  expect((await appt("appt-011")).startTime).toBe("12:15"); // was 12:00, not affected
  expect((await appt("appt-011")).status).toBe("Time moved");
}

beforeEach(() => {
  steps = [];
});

// ---------- Rule 1: opt-in, and STOP ----------

describe("WhatsApp opt-in (mock data)", () => {
  const patients = startingData.patients as Patient[];
  const optedIn = patients.filter((p) => p.whatsappOptIn);

  it("about half the patients are 'WhatsApp OK'", () => {
    expect(optedIn.length / patients.length).toBeGreaterThan(0.4);
    expect(optedIn.length / patients.length).toBeLessThan(0.6);
  });

  it("2–3 of them are 'WhatsApp fails' — and only opted-in patients", () => {
    const fails = patients.filter((p) => p.whatsappFails);
    expect(fails.length).toBeGreaterThanOrEqual(2);
    expect(fails.length).toBeLessThanOrEqual(3);
    expect(fails.every((p) => p.whatsappOptIn)).toBe(true);
  });

  it("a patient who is NOT opted in can't answer on WhatsApp", async () => {
    await away();
    expect(await whatsapp(GANESH, "I'll wait")).toBe("ignored");
    const ganesh = await appt(GANESH);
    expect(ganesh.status).toBe("Affected – needs contact");
    expect(ganesh.whatsapp).toBeUndefined();
    expect(steps).toHaveLength(1); // only "doctor unavailable" — nothing was saved
  });

  it("an opted-in patient can answer on WhatsApp, exactly as in chat", async () => {
    await away();
    expect(await whatsapp(NIKHIL, "I'll wait")).toBe("answered");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Rescheduled – later today");
    expect(nikhil.startTime).toBe("12:30"); // the earliest empty slot
    expect(nikhil.whatsapp!.at(-1)!.text).toBe(laterTodayReply("English", "12:30"));
    expect(nikhil.chat).toBeUndefined(); // kept apart from the call chat
  });

  it("a patient nobody contacted is ignored", async () => {
    await away();
    expect(await whatsapp("appt-015", "I'll wait")).toBe("ignored"); // 1:15 PM, not affected
  });
});

describe("STOP", () => {
  it("turns WhatsApp off for that appointment only — calls continue", async () => {
    await away();
    expect(await whatsapp(NIKHIL, "STOP")).toBe("stopped");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.whatsappStopped).toBe(true);
    expect(nikhil.status).toBe("Affected – needs contact"); // nothing else changed
    expect(nikhil.whatsapp!.at(-1)!.from).toBe("patient"); // no reply after STOP

    // Later WhatsApp messages are ignored…
    expect(await whatsapp(NIKHIL, "I'll wait")).toBe("ignored");
    expect((await appt(NIKHIL)).status).toBe("Affected – needs contact");

    // …but the call still reaches them and works.
    const { id } = (await getUnavailabilities())[0];
    expect((await getCallQueue(id))[0].id).toBe(NIKHIL);
    expect(await recordCallResult(NIKHIL, "Wants later today")).toBe(true);
    expect((await appt(NIKHIL)).status).toBe("Rescheduled – later today");

    // Another patient's WhatsApp is not affected.
    expect(await whatsapp(KIRAN, "cancel")).toBe("answered");
  });

  it("works in any letter case, but only as the whole message", async () => {
    await away();
    expect(await whatsapp(KIRAN, "please stop calling me")).not.toBe("stopped");
    expect((await appt(KIRAN)).whatsappStopped).toBeUndefined();
    expect(await whatsapp(KIRAN, "  stop ")).toBe("stopped");
    expect((await appt(KIRAN)).whatsappStopped).toBe(true);
  });

  it("after STOP, the one update goes by SMS", async () => {
    await away();
    await whatsapp(NIKHIL, "stop");
    await recordCallResult(NIKHIL, "Wants later today");
    expect(await sendPendingUpdates()).toBe(1);
    const [message] = await getMessages();
    expect(message.appointmentId).toBe(NIKHIL);
    expect(message.channel).toBe("SMS");
    expect(message.whatsappFailed).toBeUndefined(); // not a failure — they asked for it
  });
});

// ---------- Rule 2: channel ----------

describe("which channel an answer came from", () => {
  it("is recorded for WhatsApp answers and for call answers", async () => {
    await away();
    await whatsapp(NIKHIL, "I'll wait");
    await recordCallResult(GANESH, "Wants later today");

    const nikhil = await appt(NIKHIL);
    expect(nikhil.answeredVia).toBe("WhatsApp");
    expect(nikhil.callLog!.at(-1)!.channel).toBe("WhatsApp");
    expect(nikhil.callLog!.at(-1)!.result).toBe("Wants later today");

    const ganesh = await appt(GANESH);
    expect(ganesh.answeredVia ?? "call").toBe("call");
    expect(ganesh.callLog!.at(-1)!.channel ?? "call").toBe("call");
  });
});

// ---------- Rule 3: last finished answer wins ----------

describe("changing an answer on WhatsApp", () => {
  it("a call answer, then a WhatsApp change: the old slot is freed", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    expect((await appt(NIKHIL)).startTime).toBe("12:30");

    // Asking for another day only shows offers: the booking stays for now.
    expect(await whatsapp(NIKHIL, "another day please")).toBe("replied");
    let nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Rescheduled – later today");
    expect(nikhil.startTime).toBe("12:30");
    expect(nikhil.change!.offers!.length).toBeGreaterThan(0);
    expect(nikhil.answerChanges ?? 0).toBe(0);
    expect(await timesToday()).toContain("12:30"); // still theirs

    // Picking an offer finishes the new answer.
    const picked = nikhil.change!.offers![0];
    expect(await whatsapp(NIKHIL, "A")).toBe("changed");
    nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Rescheduled – another day");
    expect(nikhil.dayOffset).toBe(picked.dayOffset);
    expect(nikhil.startTime).toBe(picked.startTime);
    expect(nikhil.answerChanges).toBe(1);
    expect(nikhil.answeredVia).toBe("WhatsApp");
    expect(nikhil.change).toBeUndefined();

    // 12:30 today is free again: the next "later today" patient gets it.
    expect(await timesToday()).not.toContain("12:30");
    await recordCallResult(GANESH, "Wants later today");
    expect((await appt(GANESH)).startTime).toBe("12:30");
  });

  it("the new answer is re-checked like a fresh answer (a taken slot is refused)", async () => {
    await away();
    await whatsapp(NIKHIL, "another day");
    const offer = (await appt(NIKHIL)).offers![0];
    await whatsapp(NIKHIL, "A");
    await recordCallResult(KIRAN, "Wants later today"); // Kiran: 12:30 today

    // Kiran asks for another day and is offered a slot; Nikhil's is not among them.
    await whatsapp(KIRAN, "another day");
    const offers = (await appt(KIRAN)).change!.offers!;
    expect(offers).not.toContainEqual(offer);
  });

  it("patients who were pushed stay where they are", async () => {
    await fillTodayThenPushRevathiIn();
    const before = (await meeraToday())
      .filter((a) => a.id !== REVATHI)
      .map((a) => [a.id, a.startTime]);

    expect(await whatsapp(REVATHI, "cancel")).toBe("changed");
    expect((await appt(REVATHI)).status).toBe("Cancelled");

    // Nobody moved back.
    const after = (await meeraToday()).map((a) => [a.id, a.startTime]);
    expect(after).toEqual(before);
    expect((await appt("appt-011")).startTime).toBe("12:15");
    expect((await appt("appt-011")).status).toBe("Time moved");

    // The freed 12:00 slot goes to the next patient — without another push.
    await recordCallResult(DIVYA, "Wants later today");
    expect((await appt(DIVYA)).startTime).toBe("12:00");
    expect((await appt("appt-011")).startTime).toBe("12:15");
  });

  it("the 45-minute cap still counts every push, also after a change", async () => {
    await fillTodayThenPushRevathiIn(); // push 1 (15 minutes)
    await whatsapp(REVATHI, "another day");
    await whatsapp(REVATHI, "A"); // Revathi leaves today; 12:00 is empty again
    await recordCallResult(DIVYA, "Wants later today"); // takes 12:00, no push
    await recordCallResult("appt-009", "Wants later today"); // push 2 (30 minutes)
    expect((await appt("appt-011")).startTime).toBe("12:30");

    // Revathi comes back to today: push 3 (45 minutes) is still allowed…
    expect(await whatsapp(REVATHI, "I'll wait today")).toBe("changed");
    expect((await appt(REVATHI)).status).toBe("Rescheduled – later today");
    expect((await appt("appt-011")).startTime).toBe("12:45"); // 45 minutes after 12:00

    // …but nobody is EVER pushed a 4th time. Kiran (pushed along to 5:00 PM)
    // asks to wait again: no room today, so other days are offered and
    // Kiran's booking stays as it is.
    const kiran = await appt(KIRAN);
    const everyone = (await meeraToday()).map((x) => [x.id, x.startTime]);
    expect(await whatsapp(KIRAN, "I'll wait")).toBe("replied");
    expect((await appt(KIRAN)).startTime).toBe(kiran.startTime);
    expect((await appt(KIRAN)).status).toBe("Rescheduled – later today");
    expect((await appt(KIRAN)).change!.offers!.every((o) => o.dayOffset > 0)).toBe(true);
    expect((await meeraToday()).map((x) => [x.id, x.startTime])).toEqual(everyone);
    for (const a of await meeraToday()) {
      if (a.unavailabilityId) continue; // only patients who were NOT affected
      const first = a.timeHistory?.[0]?.oldStartTime ?? a.startTime;
      const [h1, m1] = first.split(":").map(Number);
      const [h2, m2] = a.startTime.split(":").map(Number);
      expect(h2 * 60 + m2 - (h1 * 60 + m1)).toBeLessThanOrEqual(45);
    }
  });

  it(`at most ${MAX_ANSWER_CHANGES} changes: the 3rd attempt goes to staff and changes nothing`, async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today"); // 12:30
    expect(await whatsapp(NIKHIL, "cancel")).toBe("changed"); // change 1
    expect(await whatsapp(NIKHIL, "I'll wait")).toBe("changed"); // change 2
    let nikhil = await appt(NIKHIL);
    expect(nikhil.answerChanges).toBe(2);
    expect(nikhil.status).toBe("Rescheduled – later today");
    expect(nikhil.startTime).toBe("12:30");
    const history = nikhil.timeHistory!.length;

    expect(await whatsapp(NIKHIL, "cancel")).toBe("keeps changing"); // attempt 3
    nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Needs staff call");
    expect(nikhil.note).toBe("Keeps changing");
    expect(nikhil.answerChanges).toBe(2);
    // Nothing changed: same time, slot still held, no new history.
    expect(nikhil.dayOffset).toBe(0);
    expect(nikhil.startTime).toBe("12:30");
    expect(nikhil.timeHistory!.length).toBe(history);
    expect(await timesToday()).toContain("12:30");
    expect((await getStaffCallList()).map((a) => a.id)).toContain(NIKHIL);

    // Once with staff, WhatsApp can't change anything.
    expect(await whatsapp(NIKHIL, "cancel")).toBe("replied");
    expect((await appt(NIKHIL)).status).toBe("Needs staff call");
  });

  it("picking the slot they already have is not counted as a change", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today"); // 12:30
    const history = (await appt(NIKHIL)).timeHistory!.length;

    expect(await whatsapp(NIKHIL, "I'll wait")).toBe("same slot"); // 12:30 again
    const nikhil = await appt(NIKHIL);
    expect(nikhil.answerChanges ?? 0).toBe(0);
    expect(nikhil.startTime).toBe("12:30");
    expect(nikhil.status).toBe("Rescheduled – later today");
    expect(nikhil.timeHistory!.length).toBe(history);
    expect(nikhil.whatsapp!.at(-1)!.text).toBe(laterTodayReply("English", "12:30"));

    // Also with another doctor: picking the same time with Dr. Karthik again.
    await recordCallResult(KIRAN, "Wants another doctor today");
    await chooseOffer(KIRAN, 0);
    const kiran = await appt(KIRAN);
    await whatsapp(KIRAN, "another doctor today");
    const again = (await appt(KIRAN)).change!.offers!.findIndex(
      (o) => o.startTime === kiran.startTime,
    );
    expect(again).toBeGreaterThanOrEqual(0); // their own slot is offered again
    expect(await whatsapp(KIRAN, "ABC"[again])).toBe("same slot");
    expect((await appt(KIRAN)).answerChanges ?? 0).toBe(0);
    expect((await appt(KIRAN)).doctorId).toBe(KARTHIK);
  });

  it("from another doctor back to the first doctor: the other doctor's slot is freed", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants another doctor today");
    await chooseOffer(NIKHIL, 0);
    const withKarthik = await appt(NIKHIL);
    expect(withKarthik.doctorId).toBe(KARTHIK);

    expect(await whatsapp(NIKHIL, "I'll wait for later today")).toBe("changed");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.doctorId).toBe(MEERA);
    expect(nikhil.status).toBe("Rescheduled – later today");
    expect(nikhil.startTime).toBe("12:30"); // after Dr. Meera is back
    const karthikToday = (await getAppointmentsForDay(KARTHIK, 0)).map((a) => a.startTime);
    expect(karthikToday).not.toContain(withKarthik.startTime);
  });

  it("unclear messages after an answer never count and never reach staff", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    for (const text of ["ok thanks", "hmm", "ok thanks", "C"]) {
      expect(await whatsapp(NIKHIL, text)).toBe("replied");
    }
    const nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Rescheduled – later today");
    expect(nikhil.answerChanges ?? 0).toBe(0);
    expect(nikhil.whatsapp!.at(-1)!.text).toBe(laterTodayReply("English", "12:30"));
  });

  it("a patient who didn't pick up can answer on WhatsApp — a first answer, not a change", async () => {
    await away();
    await recordCallResult(NIKHIL, "No answer");
    expect(await whatsapp(NIKHIL, "I'll wait")).toBe("answered");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Rescheduled – later today");
    expect(nikhil.answerChanges ?? 0).toBe(0);
  });
});

// ---------- Rule 4: the call queue ----------

describe("call queue", () => {
  it("skips anyone who has already answered (call or WhatsApp)", async () => {
    await away();
    const { id } = (await getUnavailabilities())[0];
    expect((await getCallQueue(id)).map((a) => a.id).slice(0, 3)).toEqual([NIKHIL, GANESH, KIRAN]);

    await whatsapp(NIKHIL, "cancel"); // answered on WhatsApp
    await recordCallResult(GANESH, "Wants later today"); // answered on a call
    const queue = (await getCallQueue(id)).map((a) => a.id);
    expect(queue).not.toContain(NIKHIL);
    expect(queue).not.toContain(GANESH);
    expect(queue[0]).toBe(KIRAN);
    expect(queue).toHaveLength(8);

    // And a call can't record an answer for them any more.
    expect(await recordCallResult(NIKHIL, "Wants later today")).toBe(false);
  });

  it("moves a patient who started on WhatsApp but hasn't finished to the end", async () => {
    await away();
    const { id } = (await getUnavailabilities())[0];
    expect(await whatsapp(NIKHIL, "another day")).toBe("replied"); // offers shown, no pick yet
    let queue = (await getCallQueue(id)).map((a) => a.id);
    expect(queue).toHaveLength(10);
    expect(queue[0]).toBe(GANESH);
    expect(queue.at(-1)).toBe(NIKHIL);

    // Once they finish, they leave the queue.
    await whatsapp(NIKHIL, "A");
    queue = (await getCallQueue(id)).map((a) => a.id);
    expect(queue).not.toContain(NIKHIL);
    expect(queue).toHaveLength(9);
  });
});

// ---------- Rule 5 (and A): the health check runs first ----------

describe("health check on WhatsApp", () => {
  it("a health word from an opted-in patient → URGENT, exactly as in chat", async () => {
    await away();
    expect(await whatsapp(NIKHIL, "I have chest pain")).toBe("urgent");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("URGENT – staff call now");
    expect(nikhil.whatsapp!.at(-1)!.text).toBe(urgentReply("English"));
    expect((await getStaffCallList())[0].id).toBe(NIKHIL);
  });

  it("a health word AFTER an answer still goes URGENT — and nothing is rebooked", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    expect(await whatsapp(NIKHIL, "ok, but I feel dizzy now")).toBe("urgent");
    let nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("URGENT – staff call now");
    expect(nikhil.startTime).toBe("12:30"); // their booking is untouched
    expect(nikhil.answerChanges ?? 0).toBe(0);

    // A false alarm puts back the answer they had.
    expect(await markFalseAlarm(NIKHIL)).toBe(true);
    nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Rescheduled – later today");
    expect(nikhil.startTime).toBe("12:30");
  });

  it("the health check wins over everything else in the message", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    await sendPendingUpdates();
    expect(await whatsapp(NIKHIL, "cancel it, I have chest pain")).toBe("urgent");
    expect((await appt(NIKHIL)).status).toBe("URGENT – staff call now");
    // Tamil, half-way through a change:
    await whatsapp(REVATHI, "naan wait panren");
    await whatsapp(REVATHI, "vera naal");
    expect(await whatsapp(REVATHI, "thala suthudhu")).toBe("urgent");
    expect((await appt(REVATHI)).status).toBe("URGENT – staff call now");
  });

  it("EXCEPTION: a health word after STOP gets only the emergency line — NOT URGENT", async () => {
    await away();
    await whatsapp(NIKHIL, "STOP");
    expect(await whatsapp(NIKHIL, "I have chest pain")).toBe("emergency line");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Affected – needs contact");
    expect(nikhil.note).toBeUndefined();
    expect(nikhil.whatsapp!.at(-1)!.text).toBe(emergencyOnlyReply());
    expect(emergencyOnlyReply()).toBe(
      "If this is an emergency or you're worried, please call 108 or go to the nearest " +
        "emergency department now. Don't wait for this appointment.",
    );
    expect((await getStaffCallList()).map((a) => a.id)).not.toContain(NIKHIL);
    // Every other message from them is ignored.
    expect(await whatsapp(NIKHIL, "cancel")).toBe("ignored");
  });

  it("EXCEPTION: a health word from a patient who is NOT opted in — the same", async () => {
    await away();
    expect(await whatsapp(GANESH, "nenju vali")).toBe("emergency line");
    const ganesh = await appt(GANESH);
    expect(ganesh.status).toBe("Affected – needs contact");
    expect(ganesh.note).toBeUndefined();
    expect(ganesh.whatsapp!.at(-1)!.text).toBe(emergencyOnlyReply());
    expect((await getStaffCallList()).map((a) => a.id)).not.toContain(GANESH);
    expect(await whatsapp(GANESH, "cancel")).toBe("ignored");
    expect((await appt(GANESH)).status).toBe("Affected – needs contact");
  });
});

// ---------- Rules 6 and 7 (and C, D): updates ----------

describe("updates: WhatsApp or SMS, never both", () => {
  it("opted-in → WhatsApp; 'WhatsApp fails' → SMS fallback; everyone else → SMS", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today"); // WhatsApp OK
    await recordCallResult(GANESH, "Wants later today"); // not on WhatsApp
    await recordCallResult(DIVYA, "Wants later today"); // WhatsApp fails
    expect(await getMessages()).toHaveLength(0); // nothing until staff press "Send updates"
    expect(await sendPendingUpdates()).toBe(3);

    const messages = await getMessages();
    const to = (id: string) => messages.filter((m) => m.appointmentId === id);
    expect(to(NIKHIL)).toHaveLength(1);
    expect(to(NIKHIL)[0].channel).toBe("WhatsApp");
    expect(to(NIKHIL)[0].whatsappFailed).toBeUndefined();

    expect(to(GANESH)).toHaveLength(1);
    expect(to(GANESH)[0].channel).toBe("SMS");
    expect(to(GANESH)[0].whatsappFailed).toBeUndefined();

    expect(to(DIVYA)).toHaveLength(1);
    expect(to(DIVYA)[0].channel).toBe("SMS");
    expect(to(DIVYA)[0].whatsappFailed).toBe(true); // labelled as a fallback

    // The WhatsApp update is also in that patient's WhatsApp conversation.
    expect((await appt(NIKHIL)).whatsapp!.at(-1)!.text).toBe(to(NIKHIL)[0].text);
    expect((await appt(GANESH)).whatsapp).toBeUndefined();
  });

  it("no patient ever gets both — one message per patient per send", async () => {
    await fillTodayThenPushRevathiIn();
    await whatsapp(REVATHI, "another day");
    await whatsapp(REVATHI, "A");
    const pending = await getPendingUpdates();
    expect(new Set(pending.map((u) => u.appointmentId)).size).toBe(pending.length);
    expect(await sendPendingUpdates()).toBe(pending.length);

    const messages = await getMessages();
    const ids = messages.map((m) => m.appointmentId);
    expect(new Set(ids).size).toBe(ids.length); // one each: never SMS + WhatsApp
    expect(messages.some((m) => m.channel === "WhatsApp")).toBe(true);
    expect(messages.some((m) => m.channel === "SMS")).toBe(true);
    expect(await sendPendingUpdates()).toBe(0); // and nothing is sent twice
  });

  it("a change after an update was sent makes a new pending update", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    await sendPendingUpdates();
    expect(await getPendingUpdates()).toHaveLength(0);

    await whatsapp(NIKHIL, "another day");
    expect(await getPendingUpdates()).toHaveLength(0); // not finished yet
    await whatsapp(NIKHIL, "A");
    const pending = await getPendingUpdates();
    expect(pending).toHaveLength(1);
    expect(pending[0].appointmentId).toBe(NIKHIL);
    expect(pending[0].newStartTime).toBe((await appt(NIKHIL)).startTime);

    await sendPendingUpdates();
    expect((await getMessages()).filter((m) => m.appointmentId === NIKHIL)).toHaveLength(2);
  });

  it("changing to 'cancel' removes an update that wasn't sent yet", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    expect(await getPendingUpdates()).toHaveLength(1);
    expect(await whatsapp(NIKHIL, "cancel")).toBe("changed");
    expect(await getPendingUpdates()).toHaveLength(0);
    expect(await sendPendingUpdates()).toBe(0);
  });

  it("pushed patients get a short 'no need to reply' heads-up, not 'Reply 1/2'", async () => {
    await fillTodayThenPushRevathiIn();
    await sendPendingUpdates();
    const messages = await getMessages();
    const to = (id: string) => messages.filter((m) => m.appointmentId === id);

    // appt-011 (Hindi, WhatsApp OK) was pushed from 12:00 to 12:15.
    expect(to("appt-011")).toHaveLength(1);
    expect(to("appt-011")[0].headsUp).toBe(true);
    expect(to("appt-011")[0].channel).toBe("WhatsApp");
    expect(to("appt-011")[0].text).toContain("15 ");
    expect(to("appt-011")[0].text).toContain("जवाब देने की ज़रूरत नहीं है"); // "no need to reply"
    expect(to("appt-011")[0].text).not.toContain("पुष्टि"); // no "reply 1 to confirm…"

    // appt-012 (English, not on WhatsApp): by SMS.
    expect(to("appt-012")).toHaveLength(1);
    expect(to("appt-012")[0].channel).toBe("SMS");
    expect(to("appt-012")[0].text).toBe(
      "Sunrise Multispeciality Hospital: your appointment with Dr. Meera Krishnan may start " +
        "up to 15 minutes later, around 12:30 PM. No need to reply.",
    );

    // appt-013 (WhatsApp fails): SMS fallback.
    expect(to("appt-013")[0].channel).toBe("SMS");
    expect(to("appt-013")[0].whatsappFailed).toBe(true);

    // The patient who was rebooked still gets the update they can answer.
    expect(to(REVATHI)[0].headsUp).toBeUndefined();
    expect(to(NIKHIL)[0].text).toContain("Reply 1 to confirm, 2 to change");

    // A pushed patient's reply changes nothing (unless it's a health concern).
    expect(await whatsapp("appt-011", "1")).toBe("ignored");
    expect((await appt("appt-011")).startTime).toBe("12:15");
    expect(await whatsapp("appt-011", "seene mein dard hai")).toBe("urgent");
  });
});

describe("replies to the update message (1 = confirm, 2 = change)", () => {
  it("'1' after an update never rebooks and is not a change", async () => {
    await fillTodayThenPushRevathiIn(); // today is full: a real "1 – later today" would push
    await sendPendingUpdates();
    const before = (await meeraToday()).map((a) => [a.id, a.startTime, a.status]);
    const history = (await appt(NIKHIL)).timeHistory!.length;

    expect(await whatsapp(NIKHIL, "1")).toBe("confirmed");
    expect(await whatsapp(NIKHIL, " 1 ")).toBe("confirmed"); // again: still just a confirmation
    const nikhil = await appt(NIKHIL);
    expect(nikhil.answerChanges ?? 0).toBe(0);
    expect(nikhil.timeHistory!.length).toBe(history);
    expect(nikhil.whatsapp!.at(-1)!.text).toBe(laterTodayReply("English", nikhil.startTime));
    expect((await meeraToday()).map((a) => [a.id, a.startTime, a.status])).toEqual(before);
    expect(await getPendingUpdates()).toHaveLength(0);
  });

  it("'2' alone shows the choices and never counts as a change", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    await sendPendingUpdates();

    expect(await whatsapp(NIKHIL, "2")).toBe("menu");
    let nikhil = await appt(NIKHIL);
    expect(nikhil.whatsapp!.at(-1)!.text).toBe(changeMenuReply("English"));
    expect(nikhil.answerChanges ?? 0).toBe(0);
    expect(nikhil.status).toBe("Rescheduled – later today"); // NOT "another day" offers
    expect(nikhil.startTime).toBe("12:30");
    expect(nikhil.change?.offers).toBeUndefined();

    // Now the numbers mean the menu: 3 = cancel — counted once.
    expect(await whatsapp(NIKHIL, "3")).toBe("changed");
    nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Cancelled");
    expect(nikhil.answerChanges).toBe(1);
  });

  it("without an update, '2' alone on WhatsApp is still the menu's 'another day'", async () => {
    await away();
    expect(await whatsapp(NIKHIL, "2")).toBe("replied");
    expect((await appt(NIKHIL)).offers!.length).toBeGreaterThan(0);
  });
});

// ---------- Saving WhatsApp messages in the visitor's cookie ----------

describe("saving a WhatsApp message", () => {
  it("a WhatsApp step survives being written to the cookie and read back", () => {
    const step: DemoStep = {
      kind: "whatsapp",
      at: 1_790_000_000_000,
      appointmentId: "appt-012",
      text: "வியாழன் மாலை 4 மணிக்கு பிறகு",
      understanding: { intent: "another_day", preferences: { dayOffset: 4, after: "16:00" } },
    };
    const back = decodeStep(encodeStep(step));
    expect(back).toMatchObject({ ...step, understanding: { intent: "another_day" } });
    expect(encodeStep(step).startsWith("w.")).toBe(true);
  });

  it("rebuilding the demo from its saved steps gives the same result", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    await whatsapp(NIKHIL, "another day");
    await whatsapp(NIKHIL, "A");
    await whatsapp(KIRAN, "STOP");
    const first = [await appt(NIKHIL), await appt(KIRAN)];
    steps = steps.map((s) => decodeStep(encodeStep(s))!); // as if read back from the cookie
    expect([await appt(NIKHIL), await appt(KIRAN)]).toEqual(first);
  });
});
