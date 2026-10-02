// Tests for WhatsApp Part 2: the WhatsApp screen, voice notes and photos —
// run with: npm test.
//
// These run the real code in the fake HMS. As in the other hms tests, the
// only thing swapped out is where a visitor's demo history is kept.
//
// The mock hospital (mockData.json): Dr. Meera Krishnan (doc-cardio) is away
// 9:00 AM – 12:00 PM, which affects appt-001 … appt-010. Patients with an odd
// number are "WhatsApp OK". Dr. Karthik Raman (doc-cardio-2) covers for her;
// his empty slots today are 9:30, 10:45, 11:30, 1:15, 2:30, 3:45 and 4:30.
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  chooseOffer,
  getAnotherDoctorOptions,
  getAppointment,
  getAppointmentsForDay,
  getCallQueue,
  getStaffCallList,
  getUnavailabilities,
  markDoctorUnavailable,
  recordCallResult,
  resetDemo,
  sendPendingUpdates,
  sendWhatsAppMessage,
} from "@/hms/mockHms";
import type { Appointment, Language } from "@/hms/types";
import { decodeStep, encodeStep, MAX_CHAT_TEXT } from "@/hms/visitorState";
import { couldntUnderstandReply, emergencyOnlyReply, urgentReply } from "@/lib/chatReplies";
import { mentionsHealth } from "@/lib/understanding";
import { bubbleTime, tapListFor, UNWELL_MESSAGE } from "./whatsappMenu";

const MEERA = "doc-cardio";
const KARTHIK = "doc-cardio-2";
const NIKHIL = "appt-001"; // English, WhatsApp OK
const GANESH = "appt-002"; // Tamil, NOT on WhatsApp
const KIRAN = "appt-003"; // Hindi, WhatsApp OK
const REVATHI = "appt-005"; // Tamil, WhatsApp OK

const away = () =>
  markDoctorUnavailable({
    doctorId: MEERA,
    reason: "Emergency surgery",
    fromTime: "09:00",
    untilTime: "12:00",
  });
const appt = async (id: string) => (await getAppointment(id))!;
const whatsapp = sendWhatsAppMessage;
const lastReply = async (id: string) => (await appt(id)).whatsapp!.at(-1)!;
const urgentIds = async () =>
  (await getStaffCallList()).filter((a) => a.status === "URGENT – staff call now").map((a) => a.id);
// The tap-list the screen shows for this appointment right now.
const tapList = async (id: string) => {
  const a = await appt(id);
  const free = (await getAnotherDoctorOptions(id)).length > 0;
  return tapListFor(a, a.patient.preferredLanguage, free);
};
const labels = async (id: string) => (await tapList(id)).options.map((o) => o.label);
// Tap the button whose label starts with `start` (sends what the button sends).
const tap = async (id: string, start: string) => {
  const option = (await tapList(id)).options.find((o) => o.label.startsWith(start));
  expect(option, `button "${start}"`).toBeDefined();
  return whatsapp(id, option!.send);
};

// Seven patients take Dr. Meera's seven empty slots; then Revathi is PUSHED in
// at 12:00, so appt-011 (not affected) moves from 12:00 to 12:15.
const PUSHED = "appt-011";
async function pushSomeone() {
  await away();
  for (const id of ["appt-002", "appt-004", "appt-006", "appt-008", "appt-010", NIKHIL, KIRAN]) {
    expect(await recordCallResult(id, "Wants later today")).toBe(true);
  }
  expect(await recordCallResult(REVATHI, "Wants later today")).toBe(true);
  expect((await appt(PUSHED)).status).toBe("Time moved");
}

// Pick offer A for a patient who is looking at offers on a call.
async function pickOfferA(id: string) {
  expect(await chooseOffer(id, 0)).toBe("booked");
}

beforeEach(() => {
  steps = [];
});

// ---------- The tap-list ----------

describe("tap-list: the menu", () => {
  it("shows the call's choices plus “I’m unwell”", async () => {
    await away();
    expect(await labels(NIKHIL)).toEqual([
      "1 – Later today",
      "2 – Another day",
      "3 – Cancel",
      "4 – Talk to a person",
      "5 – Another doctor today",
      "I’m unwell",
    ]);
  });

  it("option 5 is hidden when no other doctor has a free slot", async () => {
    await away();
    expect(await labels(NIKHIL)).toContain("5 – Another doctor today");
    // Other affected patients take every empty slot Dr. Karthik has today
    // (each presses 5 on a call and picks the earliest time).
    const takers = ["appt-002", "appt-004", "appt-006", "appt-008", "appt-010", KIRAN, REVATHI];
    while ((await getAnotherDoctorOptions(NIKHIL)).length > 0) {
      const taker = takers.shift();
      expect(taker, "ran out of patients to fill the slots").toBeDefined();
      expect(await recordCallResult(taker!, "Wants another doctor today")).toBe(true);
      await pickOfferA(taker!);
    }
    expect(await labels(NIKHIL)).not.toContain("5 – Another doctor today");
    expect(await labels(NIKHIL)).toContain("1 – Later today");
  });

  it("there is no STOP button — in any state", async () => {
    const seen: string[][] = [];
    await pushSomeone();
    seen.push(await labels(PUSHED)); // pushed, heads-up not sent → nothing
    seen.push(await labels(REVATHI)); // answered, no update yet → the menu
    await sendPendingUpdates();
    seen.push(await labels(REVATHI)); // update sent → 1 keep / 2 change
    seen.push(await labels(PUSHED)); // heads-up sent → 1 / 2 / 3
    await tap(PUSHED, "2");
    seen.push(await labels(PUSHED)); // "Reply YES to cancel" → YES / No
    await tap(REVATHI, "2");
    seen.push(await labels(REVATHI)); // the change menu
    await tap(REVATHI, "2");
    seen.push(await labels(REVATHI)); // offers A / B / C
    steps = [];
    await away();
    seen.push(await labels(NIKHIL)); // not answered → the menu
    await tap(NIKHIL, "2");
    seen.push(await labels(NIKHIL)); // offers
    expect(seen.filter((l) => l.length > 0).length).toBeGreaterThanOrEqual(7);
    for (const list of seen) {
      for (const label of list) expect(label.toLowerCase()).not.toContain("stop");
    }
    // …and nothing a button SENDS is "stop" either.
    const sends = (await tapList(NIKHIL)).options.map((o) => o.send.toLowerCase());
    expect(sends).not.toContain("stop");
    // The box itself has no STOP button.
    const box = readFileSync(join(process.cwd(), "src/app/whatsapp/[id]/WhatsAppBox.tsx"), "utf8");
    expect(box).not.toMatch(/>\s*STOP\s*</i);
  });

  it("no tap-list after STOP, or once the patient is with staff", async () => {
    await away();
    await whatsapp(NIKHIL, "STOP");
    expect(await labels(NIKHIL)).toEqual([]);
    await tap(KIRAN, "4");
    expect((await appt(KIRAN)).status).toBe("Needs staff call");
    expect(await labels(KIRAN)).toEqual([]);
  });

  it("a patient who is not “WhatsApp OK” has no chat at all", async () => {
    await away();
    expect((await appt(GANESH)).patient.whatsappOptIn).not.toBe(true);
    expect(await whatsapp(GANESH, "1")).toBe("ignored");
    expect((await appt(GANESH)).whatsapp).toBeUndefined();
  });
});

describe("tap-list: every button sends what the hms module expects", () => {
  it("menu: 1 later today, 3 cancel, 4 staff", async () => {
    await away();
    expect(await tap(NIKHIL, "1")).toBe("answered");
    expect((await appt(NIKHIL)).status).toBe("Rescheduled – later today");
    expect(await tap(KIRAN, "3")).toBe("answered");
    expect((await appt(KIRAN)).status).toBe("Cancelled");
    expect(await tap(REVATHI, "4")).toBe("answered"); // a first answer: handed to staff
    expect((await appt(REVATHI)).status).toBe("Needs staff call");
  });

  it("menu: 2 shows offers, then A books the first one", async () => {
    await away();
    expect(await tap(NIKHIL, "2")).toBe("replied");
    const offers = (await appt(NIKHIL)).offers!;
    expect((await labels(NIKHIL)).slice(0, offers.length).every((l, i) => l.startsWith("ABC"[i]))).toBe(true);
    expect(await tap(NIKHIL, "A")).toBe("answered");
    const a = await appt(NIKHIL);
    expect(a.status).toBe("Rescheduled – another day");
    expect([a.dayOffset, a.startTime]).toEqual([offers[0].dayOffset, offers[0].startTime]);
  });

  it("menu: 5 offers the other doctor's free slots, then A books one", async () => {
    await away();
    expect(await tap(NIKHIL, "5")).toBe("replied");
    const offers = (await appt(NIKHIL)).offers!;
    expect(offers.every((o) => o.doctorId === KARTHIK)).toBe(true);
    expect(await tap(NIKHIL, "A")).toBe("answered");
    expect((await appt(NIKHIL)).status).toBe("Rebooked – another doctor");
  });

  it("offers on screen: “4 – Talk to a person” goes to staff and books nothing", async () => {
    await away();
    await tap(NIKHIL, "2");
    await tap(NIKHIL, "4");
    const a = await appt(NIKHIL);
    expect(a.status).toBe("Needs staff call");
    expect(a.timeHistory).toBeUndefined();
  });

  it("after an update: “1 – Keep it” confirms and never rebooks; “2 – Change” shows the choices", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    await sendPendingUpdates();
    const before = await appt(NIKHIL);
    expect(await labels(NIKHIL)).toEqual(["1 – Keep it", "2 – Change", "I’m unwell"]);
    expect(await tap(NIKHIL, "1")).toBe("confirmed");
    const after = await appt(NIKHIL);
    expect([after.status, after.startTime, after.answerChanges]).toEqual([
      before.status,
      before.startTime,
      undefined,
    ]);
    expect(await tap(NIKHIL, "2")).toBe("menu");
    expect(await labels(NIKHIL)).toContain("3 – Cancel");
    expect((await appt(NIKHIL)).startTime).toBe(before.startTime); // nothing changed yet
  });

  it("pushed patient: 1 fine, 2 asks for YES, YES cancels, 3 goes to staff", async () => {
    await pushSomeone();
    expect(await labels(PUSHED)).toEqual([]); // nothing to reply to yet
    await sendPendingUpdates();
    expect(await labels(PUSHED)).toEqual([
      "1 – That’s fine",
      "2 – Cancel",
      "3 – Talk to a person",
      "I’m unwell",
    ]);
    expect(await tap(PUSHED, "1")).toBe("fine");
    expect(await tap(PUSHED, "2")).toBe("cancel asked");
    expect((await appt(PUSHED)).status).toBe("Time moved"); // not cancelled yet
    expect(await tap(PUSHED, "No")).toBe("fine");
    expect(await tap(PUSHED, "2")).toBe("cancel asked");
    expect(await tap(PUSHED, "YES")).toBe("cancelled");
    expect((await appt(PUSHED)).status).toBe("Cancelled");

    steps = [];
    await pushSomeone();
    await sendPendingUpdates();
    expect(await tap(PUSHED, "3")).toBe("staff");
    expect((await appt(PUSHED)).note).toBe("Replied to heads-up");
    expect((await appt(PUSHED)).startTime).toBe("12:15"); // booking kept
  });

  it.each(["English", "Tamil", "Hindi"] as Language[])(
    "“I’m unwell” (%s) is caught by the health check",
    (language) => {
      expect(mentionsHealth(UNWELL_MESSAGE[language])).toBe(true);
    },
  );

  it("“I’m unwell” goes URGENT from every list, and nothing is booked", async () => {
    await away();
    expect(await tap(NIKHIL, "I’m unwell")).toBe("urgent");
    expect((await appt(NIKHIL)).status).toBe("URGENT – staff call now");
    expect((await lastReply(NIKHIL)).text).toBe(urgentReply("English"));
    await tap(KIRAN, "2"); // offers on screen
    expect(await tap(KIRAN, "I’m unwell")).toBe("urgent");
    expect((await appt(KIRAN)).timeHistory).toBeUndefined();
    expect(await urgentIds()).toEqual(expect.arrayContaining([NIKHIL, KIRAN]));
  });
});

// ---------- Voice notes ----------

describe("voice notes", () => {
  it("a health phrase said in a voice note goes URGENT — the health check runs first", async () => {
    await away();
    expect(await whatsapp(NIKHIL, "I have chest pain, can I come tomorrow", "voice")).toBe("urgent");
    const a = await appt(NIKHIL);
    expect(a.status).toBe("URGENT – staff call now");
    expect(a.whatsapp!.at(-2)).toMatchObject({ from: "patient", media: "voice" });
    expect(a.whatsapp!.at(-1)!.text).toBe(urgentReply("English"));
    expect(a.timeHistory).toBeUndefined(); // nothing booked
  });

  it("a voice note is understood like a typed message", async () => {
    await away();
    expect(await whatsapp(NIKHIL, "I'll wait for a later time today", "voice")).toBe("answered");
    expect((await appt(NIKHIL)).status).toBe("Rescheduled – later today");
    expect((await appt(NIKHIL)).answeredVia).toBe("WhatsApp");
  });

  it("a voice note that says “stop” does NOT close the chat (typed STOP still does)", async () => {
    await away();
    for (const said of ["stop", "STOP", "Stop"]) {
      expect(await whatsapp(NIKHIL, said, "voice")).not.toBe("stopped");
      expect((await appt(NIKHIL)).whatsappStopped).toBeUndefined();
      steps = steps.slice(0, 1); // back to just "doctor away"
    }
    // It was handled like any other voice note DocDelay couldn't understand.
    await whatsapp(NIKHIL, "stop", "voice");
    expect((await lastReply(NIKHIL)).text).toBe(couldntUnderstandReply("English"));
    expect((await appt(NIKHIL)).status).toBe("Affected – needs contact");
    // …and the chat still works.
    expect(await whatsapp(NIKHIL, "1")).toBe("answered");
    // Typed STOP still closes it.
    expect(await whatsapp(KIRAN, "STOP")).toBe("stopped");
    expect((await appt(KIRAN)).whatsappStopped).toBe(true);
  });

  it("a health phrase after STOP gets only the 108 reply — typed or voice — and no URGENT", async () => {
    await away();
    await whatsapp(NIKHIL, "STOP");
    for (const media of [undefined, "voice"] as const) {
      expect(await whatsapp(NIKHIL, "I have chest pain", media)).toBe("emergency line");
      expect((await lastReply(NIKHIL)).text).toBe(emergencyOnlyReply("English"));
    }
    const a = await appt(NIKHIL);
    expect(a.status).toBe("Affected – needs contact");
    expect(await urgentIds()).toEqual([]);
    // Anything else after STOP is ignored — including a voice note and a photo.
    expect(await whatsapp(NIKHIL, "1", "voice")).toBe("ignored");
    expect(await whatsapp(NIKHIL, "", "photo")).toBe("ignored");
  });

  it("a pushed patient's voice note that only says “stop”: the “Sorry…” line, no staff call", async () => {
    await pushSomeone();
    await sendPendingUpdates();
    const language = (await appt(PUSHED)).patient.preferredLanguage;
    for (const said of ["stop", "Stop it", "please stop"]) {
      expect(await whatsapp(PUSHED, said, "voice")).toBe("replied");
      const a = await appt(PUSHED);
      expect([a.status, a.startTime, a.note]).toEqual(["Time moved", "12:15", undefined]);
      expect(a.whatsappStopped).toBeUndefined(); // the chat is still open
      expect((await lastReply(PUSHED)).text).toBe(couldntUnderstandReply(language));
    }
    expect((await getStaffCallList()).map((a) => a.id)).not.toContain(PUSHED);
    // The chat still works afterwards.
    expect(await whatsapp(PUSHED, "1")).toBe("fine");
  });

  it("pushed patient: a health phrase with “stop” in a voice note still goes URGENT", async () => {
    await pushSomeone();
    await sendPendingUpdates();
    expect(await whatsapp(PUSHED, "stop, I have chest pain", "voice")).toBe("urgent");
    expect((await appt(PUSHED)).status).toBe("URGENT – staff call now");
  });

  it("pushed patient: clear wording next to “stop” in a voice note is read normally", async () => {
    await pushSomeone();
    await sendPendingUpdates();
    // Cancel wording → the YES question (nothing cancelled yet).
    expect(await whatsapp(PUSHED, "stop, I can't come, cancel it", "voice")).toBe("cancel asked");
    expect((await appt(PUSHED)).status).toBe("Time moved");
    expect(await whatsapp(PUSHED, "yes", "voice")).toBe("cancelled");

    steps = [];
    await pushSomeone();
    await sendPendingUpdates();
    // Asking for another day → the front desk, as for a typed message.
    expect(await whatsapp(PUSHED, "stop this, I want another day", "voice")).toBe("staff");
    expect((await appt(PUSHED)).note).toBe("Replied to heads-up");
  });

  it("pushed patient: a TYPED “stop” is unchanged — it closes the chat", async () => {
    await pushSomeone();
    await sendPendingUpdates();
    expect(await whatsapp(PUSHED, "stop")).toBe("stopped");
    expect((await appt(PUSHED)).whatsappStopped).toBe(true);
  });

  it("pushed patient: a “stop” voice note keeps “Reply YES to cancel” open — like a photo", async () => {
    await pushSomeone();
    await sendPendingUpdates();
    expect(await whatsapp(PUSHED, "2")).toBe("cancel asked");
    expect(await whatsapp(PUSHED, "stop", "voice")).toBe("replied");
    const a = await appt(PUSHED);
    expect((await lastReply(PUSHED)).text).toBe(couldntUnderstandReply(a.patient.preferredLanguage));
    expect([a.status, a.startTime]).toEqual(["Time moved", "12:15"]); // nothing cancelled
    expect(await labels(PUSHED)).toEqual(["YES – cancel it", "No – keep it", "I’m unwell"]);
    expect(await tap(PUSHED, "YES")).toBe("cancelled"); // YES afterwards cancels as normal
    expect((await appt(PUSHED)).status).toBe("Cancelled");
  });

  // Tamil and Hindi "stop" words (not yet native-checked), in English letters and in script.
  const STOP_SAID = [
    "niruthu",
    "Niruthunga",
    "niruthidunga",
    "நிறுத்துங்க",
    "band karo",
    "Band kar do!",
    "band kijiye",
    "बंद करो",
  ];

  it.each(STOP_SAID)(
    "pushed patient: a voice note saying “%s” gets only the “Sorry…” line — no staff call",
    async (said) => {
      await pushSomeone();
      await sendPendingUpdates();
      const language = (await appt(PUSHED)).patient.preferredLanguage;
      expect(await whatsapp(PUSHED, said, "voice")).toBe("replied");
      const a = await appt(PUSHED);
      expect([a.status, a.startTime, a.note, a.whatsappStopped]).toEqual([
        "Time moved",
        "12:15",
        undefined,
        undefined,
      ]);
      expect((await lastReply(PUSHED)).text).toBe(couldntUnderstandReply(language));
      expect((await getStaffCallList()).map((x) => x.id)).not.toContain(PUSHED);
    },
  );

  it("“ruko” (stop / wait) is read as “I'll wait”, as before — not as a stop word", async () => {
    await pushSomeone();
    await sendPendingUpdates();
    expect(await whatsapp(PUSHED, "ruko", "voice")).toBe("staff");
    expect((await appt(PUSHED)).startTime).toBe("12:15"); // booking kept
  });

  it("pushed patient: Tamil/Hindi “stop” with a health phrase still goes URGENT", async () => {
    for (const said of ["niruthu, nenju vali", "band kar do, chest pain ho raha hai", "band karo, saans lene mein dikkat"]) {
      steps = [];
      await pushSomeone();
      await sendPendingUpdates();
      expect(await whatsapp(PUSHED, said, "voice")).toBe("urgent");
    }
  });

  it("pushed patient: Tamil/Hindi “stop” with clear cancel wording is read normally", async () => {
    for (const said of ["niruthu, cancel pannidunga", "band karo, cancel kar do"]) {
      steps = [];
      await pushSomeone();
      await sendPendingUpdates();
      expect(await whatsapp(PUSHED, said, "voice")).toBe("cancel asked");
      expect((await appt(PUSHED)).status).toBe("Time moved");
    }
  });

  it("Tamil/Hindi “stop” TYPED is not STOP — only the exact word STOP closes the chat", async () => {
    await pushSomeone();
    await sendPendingUpdates();
    expect(await whatsapp(PUSHED, "band karo")).not.toBe("stopped");
    expect((await appt(PUSHED)).whatsappStopped).toBeUndefined();
  });

  it("words that only look like “stop” words don't count", async () => {
    await pushSomeone();
    await sendPendingUpdates();
    // "stopped", "bandage": not a stop word → the usual heads-up reply (front desk).
    expect(await whatsapp(PUSHED, "the bus stopped near my bandage shop", "voice")).toBe("staff");
  });

  it("the first unclear voice note: “Sorry…”, and the tap-list still has “Talk to a person”", async () => {
    await away();
    expect(await whatsapp(NIKHIL, "blah blah", "voice")).toBe("replied");
    expect((await lastReply(NIKHIL)).text).toBe(couldntUnderstandReply("English"));
    expect(await labels(NIKHIL)).toContain("4 – Talk to a person");
    // The same with offers on screen.
    await whatsapp(KIRAN, "2");
    expect(await whatsapp(KIRAN, "blah blah", "voice")).toBe("replied");
    expect((await lastReply(KIRAN)).text).toBe(couldntUnderstandReply("Hindi"));
    expect((await labels(KIRAN)).some((l) => l.startsWith("A · "))).toBe(true);
    expect(await labels(KIRAN)).toContain("4 – Talk to a person");
    // Tapping it hands the patient to staff.
    await tap(NIKHIL, "4");
    expect((await appt(NIKHIL)).status).toBe("Needs staff call");
  });

  it("two unclear voice notes before answering → Needs staff call – Couldn't understand", async () => {
    await away();
    expect(await whatsapp(KIRAN, "blah blah", "voice")).toBe("replied");
    expect((await lastReply(KIRAN)).text).toBe(couldntUnderstandReply("Hindi"));
    await whatsapp(KIRAN, "hmm hmm", "voice");
    const a = await appt(KIRAN);
    expect([a.status, a.note]).toEqual(["Needs staff call", "Couldn't understand"]);
  });

  it("an unclear voice note AFTER an answer gets the “Sorry…” line and changes nothing", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    const before = await appt(NIKHIL);
    for (let i = 0; i < 3; i++) expect(await whatsapp(NIKHIL, "blah blah", "voice")).toBe("replied");
    const after = await appt(NIKHIL);
    expect((await lastReply(NIKHIL)).text).toBe(couldntUnderstandReply("English"));
    expect([after.status, after.startTime]).toEqual([before.status, before.startTime]);
  });
});

// ---------- Photos ----------

describe("photos", () => {
  it("a photo gets the “Sorry…” reply and a staff note in the log; nothing is booked", async () => {
    await away();
    expect(await whatsapp(REVATHI, "", "photo")).toBe("replied");
    const a = await appt(REVATHI);
    expect(a.whatsapp!.at(-2)).toMatchObject({ from: "patient", media: "photo", text: "" });
    expect(a.whatsapp!.at(-1)!.text).toBe(couldntUnderstandReply("Tamil"));
    expect(a.callLog!.some((l) => l.detail === "WhatsApp: photo received — not read")).toBe(true);
    expect(a.status).toBe("Affected – needs contact");
    expect(a.timeHistory).toBeUndefined();
  });

  it("two photos before answering → Needs staff call – Couldn't understand (never URGENT)", async () => {
    await away();
    await whatsapp(NIKHIL, "", "photo");
    await whatsapp(NIKHIL, "", "photo");
    const a = await appt(NIKHIL);
    expect([a.status, a.note]).toEqual(["Needs staff call", "Couldn't understand"]);
    expect(await urgentIds()).toEqual([]);
  });

  it("a photo and an unclear typed message count together", async () => {
    await away();
    await whatsapp(NIKHIL, "", "photo");
    await whatsapp(NIKHIL, "blah blah");
    expect((await appt(NIKHIL)).status).toBe("Needs staff call");
  });

  it("photos AFTER an answer never count and never change the booking", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    const before = await appt(NIKHIL);
    for (let i = 0; i < 3; i++) expect(await whatsapp(NIKHIL, "", "photo")).toBe("replied");
    const after = await appt(NIKHIL);
    expect([after.status, after.startTime, after.note]).toEqual([
      before.status,
      before.startTime,
      before.note,
    ]);
    expect(await urgentIds()).toEqual([]);
  });

  it("a pushed patient's photo changes nothing — and never cancels", async () => {
    await pushSomeone();
    await sendPendingUpdates();
    await whatsapp(PUSHED, "2"); // "Reply YES to cancel"
    expect(await whatsapp(PUSHED, "", "photo")).toBe("replied");
    const a = await appt(PUSHED);
    expect([a.status, a.startTime]).toEqual(["Time moved", "12:15"]);
    expect((await lastReply(PUSHED)).text).toBe(couldntUnderstandReply(a.patient.preferredLanguage));
  });

  it("whatever text comes with a photo is never read", async () => {
    await away();
    expect(await whatsapp(NIKHIL, "cancel my appointment", "photo")).toBe("replied");
    expect((await appt(NIKHIL)).status).toBe("Affected – needs contact");
  });
});

// ---------- Saving ----------

describe("saving voice notes and photos", () => {
  it("they survive being written to the cookie and read back", async () => {
    await away();
    await whatsapp(NIKHIL, "naan wait panren", "voice");
    await whatsapp(KIRAN, "", "photo");
    await whatsapp(REVATHI, "1");
    for (const step of steps) expect(decodeStep(encodeStep(step))).toEqual(step);
    expect(steps.map((s) => (s.kind === "whatsapp" ? s.media : "-"))).toEqual([
      "-",
      "voice",
      "photo",
      undefined,
    ]);
  });

  it("typed messages and voice notes are cut at 200 characters", async () => {
    await away();
    const long = "x".repeat(500);
    await whatsapp(NIKHIL, long);
    await whatsapp(KIRAN, long, "voice");
    expect(MAX_CHAT_TEXT).toBe(200);
    for (const id of [NIKHIL, KIRAN]) {
      const mine = (await appt(id)).whatsapp!.filter((t) => t.from === "patient");
      expect(mine.at(-1)!.text).toHaveLength(200);
    }
    const box = readFileSync(join(process.cwd(), "src/app/whatsapp/[id]/WhatsAppBox.tsx"), "utf8");
    expect(box).toContain("const MAX_LENGTH = 200");
    expect(box.match(/maxLength=\{MAX_LENGTH\}/g)).toHaveLength(2); // typed box + voice-note box
  });

  it("Reset demo clears the WhatsApp chat", async () => {
    await away();
    await whatsapp(NIKHIL, "1");
    await whatsapp(KIRAN, "", "photo");
    expect((await appt(NIKHIL)).whatsapp).toBeDefined();
    await resetDemo();
    expect((await appt(NIKHIL)).whatsapp).toBeUndefined();
    expect((await appt(KIRAN)).whatsapp).toBeUndefined();
    expect((await appt(NIKHIL)).status).toBe("Scheduled");
    expect(await getUnavailabilities()).toEqual([]);
  });
});

// ---------- The call queue on the call screen ----------

describe("call queue", () => {
  it("skips a patient who answered on WhatsApp; a mid-reply patient goes last", async () => {
    const u = (await away())!;
    expect((await getCallQueue(u.id))[0].id).toBe(NIKHIL);
    await tap(NIKHIL, "1"); // answered on WhatsApp
    await tap(KIRAN, "2"); // looking at offers — not finished
    const queue = (await getCallQueue(u.id)).map((a) => a.id);
    expect(queue).not.toContain(NIKHIL);
    expect(queue[0]).toBe(GANESH);
    expect(queue.at(-1)).toBe(KIRAN);
  });

  it("a photo or an unclear voice note does NOT move the patient: they keep their place", async () => {
    const u = (await away())!;
    const order = async () => (await getCallQueue(u.id)).map((a) => a.id);
    const before = await order();
    expect(before[0]).toBe(NIKHIL);
    expect(await whatsapp(NIKHIL, "", "photo")).toBe("replied");
    expect(await order()).toEqual(before);
    expect(await whatsapp(KIRAN, "blah blah", "voice")).toBe("replied");
    expect(await whatsapp(REVATHI, "stop", "voice")).toBe("replied");
    expect(await order()).toEqual(before);
  });

  it("a TYPED message DocDelay couldn't understand also keeps the patient's place", async () => {
    const u = (await away())!;
    const order = async () => (await getCallQueue(u.id)).map((a) => a.id);
    const before = await order();
    expect(await whatsapp(NIKHIL, "blah blah")).toBe("replied");
    expect((await appt(NIKHIL)).status).toBe("Affected – needs contact");
    expect(await order()).toEqual(before);
    // …while a typed reply DocDelay understood (offers shown) moves them to the end.
    expect(await whatsapp(NIKHIL, "another day")).toBe("replied");
    expect((await order()).at(-1)).toBe(NIKHIL);
    // An unclear message while choosing doesn't bring them back to the front.
    await whatsapp(NIKHIL, "blah blah");
    expect((await order()).at(-1)).toBe(NIKHIL);
  });

  it("a voice note DocDelay understood (offers on screen) does move the patient to the end", async () => {
    const u = (await away())!;
    expect(await whatsapp(NIKHIL, "another day", "voice")).toBe("replied");
    expect((await appt(NIKHIL)).offers!.length).toBeGreaterThan(0);
    const queue = (await getCallQueue(u.id)).map((a) => a.id);
    expect(queue[0]).toBe(GANESH);
    expect(queue.at(-1)).toBe(NIKHIL);
    // A photo sent while choosing doesn't bring them back to the front.
    await whatsapp(NIKHIL, "", "photo");
    expect((await getCallQueue(u.id)).at(-1)!.id).toBe(NIKHIL);
  });

  it("the call screen takes its patients from getCallQueue", () => {
    const page = readFileSync(join(process.cwd(), "src/app/calls/[id]/page.tsx"), "utf8");
    expect(page).toContain("const toCall = await getCallQueue(id)");
    expect(page).toContain("const current = toCall[0]");
  });
});

// ---------- Changing an answer by typing "another doctor" ----------

describe("changing an earlier answer by typing “another doctor”", () => {
  // Is this slot really empty with that doctor right now?
  const isFree = async (doctorId: string, startTime: string, except: string) =>
    !(await getAppointmentsForDay(doctorId, 0)).some(
      (a) => a.startTime === startTime && a.status !== "Cancelled" && a.id !== except,
    );

  it("offers only real free slots, re-checked when picked; the old slot is freed", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    const before = await appt(NIKHIL);
    expect(await whatsapp(NIKHIL, "I'd like to see another doctor today")).toBe("replied");

    // Nothing has changed yet: the booking stays until the new answer is finished.
    const during = await appt(NIKHIL);
    expect([during.status, during.doctorId, during.startTime]).toEqual([
      before.status,
      MEERA,
      before.startTime,
    ]);
    const offers = during.change!.offers!;
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.length).toBeLessThanOrEqual(3);
    for (const o of offers) {
      expect(o.doctorId).toBe(KARTHIK); // an approved doctor only
      expect(o.dayOffset).toBe(0);
      expect(o.startTime >= "09:00" && o.startTime < "17:00").toBe(true); // at/after the original time, by 5 PM
      expect(await isFree(KARTHIK, o.startTime, NIKHIL)).toBe(true); // really empty
    }
    // The screen shows those offers as buttons.
    expect((await labels(NIKHIL)).slice(0, offers.length).every((l) => /^[ABC] · /.test(l))).toBe(true);

    // Someone else takes slot A first: picking it must NOT double-book.
    // (Kiran presses 5 on a call and picks the earliest time — the same slot.)
    expect(await recordCallResult(KIRAN, "Wants another doctor today")).toBe(true);
    expect((await appt(KIRAN)).offers![0]).toEqual(offers[0]);
    await pickOfferA(KIRAN);
    const result = await whatsapp(NIKHIL, "A");
    expect(["replied", "staff", "changed"]).toContain(result);
    const karthikNow = (await getAppointmentsForDay(KARTHIK, 0)).filter(
      (a) => a.startTime === offers[0].startTime && a.status !== "Cancelled",
    );
    expect(karthikNow.map((a) => a.id)).toEqual([KIRAN]); // one patient per slot
    const still = await appt(NIKHIL);
    if (result !== "changed") {
      // Back to fresh options (or the menu): the earlier booking is untouched.
      expect([still.status, still.doctorId, still.startTime]).toEqual([
        before.status,
        MEERA,
        before.startTime,
      ]);
    }

    // Now pick a slot that IS free.
    const fresh = (await appt(NIKHIL)).change?.offers;
    if (fresh?.length) {
      expect(await isFree(KARTHIK, fresh[0].startTime, NIKHIL)).toBe(true);
      expect(await whatsapp(NIKHIL, "A")).toBe("changed");
      const after = await appt(NIKHIL);
      expect([after.status, after.doctorId, after.startTime]).toEqual([
        "Rebooked – another doctor",
        KARTHIK,
        fresh[0].startTime,
      ]);
      expect(after.answerChanges).toBe(1);
      // The old slot with Dr. Meera is free again, and nobody was pushed.
      expect(await isFree(MEERA, before.startTime, "none")).toBe(true);
      const sameSlot = (await getAppointmentsForDay(KARTHIK, 0)).filter(
        (a) => a.startTime === after.startTime && a.status !== "Cancelled",
      );
      expect(sameSlot).toHaveLength(1);
    }
  });

  it("with no other doctor free: no error, no booking, the answer stays as it was", async () => {
    await away();
    await recordCallResult(NIKHIL, "Wants later today");
    const before = await appt(NIKHIL);
    // Fill Dr. Karthik's day.
    const ids = ["appt-002", "appt-004", "appt-006", "appt-008", "appt-010", KIRAN, REVATHI];
    for (const id of ids) {
      if (!(await recordCallResult(id, "Wants another doctor today"))) break;
      await pickOfferA(id);
    }
    expect(await getAnotherDoctorOptions("appt-009")).toEqual([]);
    const result = await whatsapp(NIKHIL, "another doctor please");
    expect(["replied", "staff"]).toContain(result);
    const after = await appt(NIKHIL);
    expect([after.doctorId, after.startTime, after.answerChanges]).toEqual([
      MEERA,
      before.startTime,
      undefined,
    ]);
    expect(after.status === before.status || after.status === "Needs staff call").toBe(true);
  });
});

// ---------- Times and privacy ----------

describe("what the screen shows", () => {
  it("every message time is the demo clock's 9:00 AM, never the real time", async () => {
    await pushSomeone();
    await sendPendingUpdates();
    await whatsapp(REVATHI, "2");
    await whatsapp(REVATHI, "kal subah", "voice");
    await whatsapp(PUSHED, "", "photo");
    const turns = [...(await appt(REVATHI)).whatsapp!, ...(await appt(PUSHED)).whatsapp!];
    expect(turns.length).toBeGreaterThan(4);
    for (const turn of turns) expect(bubbleTime(turn.at)).toBe("9:00 AM");
    expect(bubbleTime("")).toBe("9:00 AM"); // DocDelay's first message, before any reply
    // The transcript shows times only through bubbleTime.
    const transcript = readFileSync(
      join(process.cwd(), "src/app/whatsapp/[id]/WhatsAppTranscript.tsx"),
      "utf8",
    );
    expect(transcript.match(/bubbleTime\(turn\.at\)/g)).toHaveLength(2);
    expect(transcript).not.toMatch(/toLocale|new Date|Date\.now/);
  });

  it("no WhatsApp message from DocDelay ever names the reason for the visit", async () => {
    await pushSomeone();
    await sendPendingUpdates();
    for (const id of [NIKHIL, KIRAN, REVATHI]) {
      await whatsapp(id, "2");
      await whatsapp(id, "2");
      await whatsapp(id, "", "photo");
      await whatsapp(id, "blah", "voice");
    }
    await whatsapp(PUSHED, "1");
    let checked = 0;
    for (const id of [NIKHIL, KIRAN, REVATHI, PUSHED]) {
      const a: Appointment = await appt(id);
      for (const turn of a.whatsapp!.filter((t) => t.from === "docdelay")) {
        expect(turn.text.toLowerCase()).not.toContain(a.reason.toLowerCase());
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(12);
  });

  it("the WhatsApp screen never uses the demo phrases or the AI", () => {
    for (const file of ["page.tsx", "WhatsAppBox.tsx", "WhatsAppTranscript.tsx", "whatsappMenu.ts"]) {
      const source = readFileSync(join(process.cwd(), "src/app/whatsapp/[id]", file), "utf8");
      expect(source).not.toMatch(/demoPhrases|aiChat|chatAction/);
    }
  });
});
