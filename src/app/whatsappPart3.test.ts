// Tests for WhatsApp Part 3 (making WhatsApp visible): the dashboard's
// WhatsApp labels and link, photo notes, "holding [time]", the Messages
// page's channel labels, and the new first WhatsApp message — run with:
// npm test.
//
// These run the real code in the fake HMS. As in the other hms tests, the
// only thing swapped out is where a visitor's demo history is kept.
//
// The mock hospital (mockData.json): Dr. Meera Krishnan (doc-cardio) is away
// 9:00 AM – 12:00 PM, which affects appt-001 … appt-010. Patients with an odd
// number are "WhatsApp OK"; appt-007, appt-009 and appt-013 are the "WhatsApp
// fails" patients.
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
  getAffectedAppointments,
  getAppointment,
  getAppointmentsForDay,
  getDoctors,
  getHospital,
  getMessages,
  markDoctorUnavailable,
  recordCallResult,
  sendChatMessage,
  sendPendingUpdates,
  sendWhatsAppMessage,
} from "@/hms/mockHms";
import { UNAVAILABILITY_REASONS, type Language, type UnavailabilityReason } from "@/hms/types";
import { callScript, whatsappScript } from "@/lib/callScript";
import { couldntUnderstandReply, emergencyOnlyReply, urgentReply } from "@/lib/chatReplies";
import { doctorNameFor } from "@/lib/names";
import { holdingLabel } from "@/lib/status";
import { interpretWithRules } from "@/lib/understanding";
import { messageChannelLabel, whatsappRowInfo } from "@/lib/whatsappStatus";

const NIKHIL = "appt-001"; // English, WhatsApp OK
const GANESH = "appt-002"; // Tamil, NOT on WhatsApp
const KIRAN = "appt-003"; // Hindi, WhatsApp OK
const REVATHI = "appt-005"; // Tamil, WhatsApp OK
const SNEHA = "appt-011"; // 12:00, not affected, WhatsApp OK

const away = (untilTime = "12:00", reason: UnavailabilityReason = "Emergency surgery") =>
  markDoctorUnavailable({ doctorId: "doc-cardio", reason, fromTime: "09:00", untilTime });
const appt = async (id: string) => (await getAppointment(id))!;
const info = async (id: string) => whatsappRowInfo(await appt(id), await getMessages());
const whatsapp = sendWhatsAppMessage;

// Seven patients take Dr. Meera's seven empty slots; then Revathi is PUSHED in
// at 12:00, so appt-011 (Sneha, not affected) moves from 12:00 to 12:15.
async function pushSneha() {
  await away();
  for (const id of ["appt-002", "appt-004", "appt-006", "appt-008", "appt-010", NIKHIL, KIRAN]) {
    expect(await recordCallResult(id, "Wants later today")).toBe(true);
  }
  expect(await recordCallResult(REVATHI, "Wants later today")).toBe(true);
  expect((await appt(SNEHA)).status).toBe("Time moved");
}

beforeEach(() => {
  steps = [];
});

describe("dashboard: “WhatsApp OK” and the “Open WhatsApp” link", () => {
  it("“WhatsApp OK” shows only on opted-in patients, and only before contact", async () => {
    // Before anything happens: every opted-in patient today, nobody else.
    for (const a of await getAppointmentsForDay("doc-cardio", 0)) {
      expect(whatsappRowInfo(a, []).okLabel, a.id).toBe(a.patient.whatsappOptIn === true);
    }
    await away();
    // Contacted (affected) → the label is gone.
    expect((await info(NIKHIL)).okLabel).toBe(false);
    // Not opted in → never.
    expect((await info(GANESH)).okLabel).toBe(false);
    // Opted in, not affected → still there.
    expect((await info(SNEHA)).okLabel).toBe(true);
  });

  it("“Open WhatsApp” only for opted-in patients DocDelay has contacted", async () => {
    // Before contact: no link for anyone.
    for (const a of await getAppointmentsForDay("doc-cardio", 0)) {
      expect(whatsappRowInfo(a, []).link, a.id).toBe(false);
    }
    await pushSneha();
    // Affected and opted in → link. Affected, not opted in → none.
    expect((await info(NIKHIL)).link).toBe(true);
    expect((await info(GANESH)).link).toBe(false);
    // Pushed, but the heads-up isn't sent yet → none; once it's sent → link.
    expect((await info(SNEHA)).link).toBe(false);
    await sendPendingUpdates();
    expect((await info(SNEHA)).link).toBe(true);
    // Another doctor's patients (never affected or moved) → none.
    for (const a of await getAppointmentsForDay("doc-ortho", 0)) {
      expect(whatsappRowInfo(a, await getMessages()).link, a.id).toBe(false);
    }
  });

  it("the row link opens the WhatsApp chat without opening the details panel", () => {
    const source = readFileSync(join(process.cwd(), "src/app/WhatsAppRowLink.tsx"), "utf8");
    expect(source).toContain("e.stopPropagation()");
    expect(source).toContain("min-h-11"); // at least 44 px tall
    const page = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(page.match(/<WhatsAppRowLink /g)).toHaveLength(2); // phone cards and the table
  });
});

describe("dashboard: photo notes never replace a status", () => {
  it("URGENT keeps its status; the photo is a separate line", async () => {
    await away();
    await whatsapp(NIKHIL, "I have chest pain");
    await whatsapp(NIKHIL, "", "photo");
    const a = await appt(NIKHIL);
    expect(a.status).toBe("URGENT – staff call now");
    expect(a.note).toBeUndefined();
    expect((await info(NIKHIL)).photos).toBe(1);
  });

  it("“Needs staff call” keeps its status and its note", async () => {
    await away();
    await whatsapp(KIRAN, "4"); // talk to a person
    const note = (await appt(KIRAN)).note;
    expect((await appt(KIRAN)).status).toBe("Needs staff call");
    await whatsapp(KIRAN, "", "photo");
    await whatsapp(KIRAN, "", "photo");
    const a = await appt(KIRAN);
    expect(a.status).toBe("Needs staff call");
    expect(a.note).toBe(note);
    expect((await info(KIRAN)).photos).toBe(2);
  });

  it("the photo line is grey, never red, and isn't the status or the orange note", () => {
    const page = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
    const line = page.match(/<p data-photo-note className="([^"]+)"/);
    expect(line).not.toBeNull();
    expect(line![1]).toContain("text-slate-500");
    expect(line![1]).not.toMatch(/red|orange/);
  });
});

describe("dashboard: which channel the answer came from", () => {
  it("call, WhatsApp, and URGENT from WhatsApp", async () => {
    await away();
    expect(await recordCallResult(NIKHIL, "Wants later today")).toBe(true);
    expect(await whatsapp(KIRAN, "I'll wait")).toBe("answered");
    expect(await whatsapp(REVATHI, "enakku udambu sari illai")).toBe("urgent");
    expect((await info(NIKHIL)).answeredBy).toBe("Answered by call");
    expect((await info(KIRAN)).answeredBy).toBe("Answered on WhatsApp");
    // URGENT isn't a choice → "Last reply…"
    expect((await info(REVATHI)).answeredBy).toBe("Last reply on WhatsApp");
    // Not opted in: no channel label (it can only be a call).
    expect(await recordCallResult(GANESH, "Cancelled")).toBe(true);
    expect((await info(GANESH)).answeredBy).toBeUndefined();
  });
});

describe("dashboard: “Answered…” only when the patient made a choice", () => {
  it("no choice (two unclear replies, asked for a person, URGENT, staff call) → “Last reply…”", async () => {
    await pushSneha(); // Nikhil, Kiran and Revathi answered "later today" on a call
    // Two unclear WhatsApp replies → Needs staff call
    await whatsapp("appt-009", "hmm");
    await whatsapp("appt-009", "blah");
    expect((await appt("appt-009")).status).toBe("Needs staff call");
    expect((await info("appt-009")).answeredBy).toBe("Last reply on WhatsApp");
    // Asked for a person on WhatsApp (after a call answer)
    await whatsapp(NIKHIL, "I want to talk to a person");
    expect((await appt(NIKHIL)).status).toBe("Needs staff call");
    expect((await info(NIKHIL)).answeredBy).toBe("Last reply on WhatsApp");
    // URGENT on WhatsApp
    await whatsapp(KIRAN, "I have chest pain");
    expect((await info(KIRAN)).answeredBy).toBe("Last reply on WhatsApp");
    // Asked for a person on the call
    expect(await recordCallResult("appt-007", "Needs staff call")).toBe(true);
    expect((await info("appt-007")).answeredBy).toBe("Last reply by call");
    // A pushed patient: "3" is no choice; "YES" to cancel is.
    await sendPendingUpdates();
    await whatsapp(SNEHA, "3");
    expect((await info(SNEHA)).answeredBy).toBe("Last reply on WhatsApp");
  });

  it("a choice → “Answered…” (call and WhatsApp, including a pushed patient who cancels)", async () => {
    await pushSneha();
    expect((await info(REVATHI)).answeredBy).toBe("Answered by call");
    expect(await whatsapp("appt-007", "cancel")).toBe("answered");
    expect((await info("appt-007")).answeredBy).toBe("Answered on WhatsApp");
    await sendPendingUpdates();
    await whatsapp(SNEHA, "2");
    expect(await whatsapp(SNEHA, "YES")).toBe("cancelled");
    expect((await info(SNEHA)).answeredBy).toBe("Answered on WhatsApp");
  });
});

describe("WhatsApp updates never mention an emergency (privacy); SMS is unchanged", () => {
  const EMERGENCY = /emergency|அவசர|इमरजेंसी/i;
  // The only WhatsApp lines allowed to say "emergency": the 108 safety lines.
  const safetyLines = (language: Language) => [
    urgentReply(language),
    emergencyOnlyReply(language),
    couldntUnderstandReply(language),
  ];

  it.each(UNAVAILABILITY_REASONS)("reason: %s", async (reason) => {
    await away("12:00", reason);
    // Updates: Nikhil (English), Kiran (Hindi), Revathi (Tamil) on WhatsApp;
    // Gayathri (not opted in) and Divya ("WhatsApp fails") by SMS.
    for (const id of [NIKHIL, KIRAN, REVATHI, "appt-004", "appt-007"]) {
      expect(await recordCallResult(id, "Wants another day")).toBe(true);
      expect(await chooseOffer(id, 0)).toBe("booked");
    }
    // Some WhatsApp replies too, including the 108 lines.
    await whatsapp("appt-009", "", "photo");
    await whatsapp("appt-009", "I feel dizzy");
    await sendPendingUpdates();
    await whatsapp(NIKHIL, "2");
    await whatsapp(NIKHIL, "STOP");
    await whatsapp(NIKHIL, "I have chest pain");

    const sent = await getMessages();
    const onWhatsApp = sent.filter((m) => m.channel === "WhatsApp");
    expect(onWhatsApp.map((m) => m.appointmentId).sort()).toEqual([NIKHIL, KIRAN, REVATHI].sort());
    for (const m of onWhatsApp) {
      expect(m.text, m.appointmentId).not.toMatch(EMERGENCY);
      expect(m.text).toMatch(/schedule change|அட்டவணை மாற்றம்|समय-सारणी में बदलाव/);
    }
    // Every WhatsApp line from DocDelay: "emergency" only in the 108 lines.
    let safety = 0;
    for (const id of [NIKHIL, KIRAN, REVATHI, "appt-009"]) {
      const a = await appt(id);
      for (const turn of (a.whatsapp ?? []).filter((t) => t.from === "docdelay")) {
        if (!EMERGENCY.test(turn.text)) continue;
        expect(safetyLines(a.patient.preferredLanguage), turn.text).toContain(turn.text);
        safety++;
      }
    }
    expect(safety).toBeGreaterThan(0);
    // SMS wording is unchanged: an emergency reason still says so.
    const sms = sent.filter((m) => m.channel === "SMS");
    expect(sms).toHaveLength(2);
    for (const m of sms) {
      if (reason === "Other") expect(m.text).toContain("due to a schedule change");
      else expect(m.text).toContain("due to an emergency");
    }
  });
});

describe("dashboard: where WhatsApp stands", () => {
  it("sent → replied → update sent → closed after STOP", async () => {
    await away();
    expect((await info(NIKHIL)).state).toBe("WhatsApp sent");
    await whatsapp(NIKHIL, "I'll wait");
    expect((await info(NIKHIL)).state).toBe("Replied on WhatsApp");
    await sendPendingUpdates();
    expect((await info(NIKHIL)).state).toBe("Update sent (WhatsApp)");
    await whatsapp(NIKHIL, "1"); // confirms the update
    expect((await info(NIKHIL)).state).toBe("Replied on WhatsApp");
    await whatsapp(NIKHIL, "STOP");
    expect((await info(NIKHIL)).state).toBe("WhatsApp closed (STOP)");
  });

  it("a “WhatsApp fails” patient's update → WhatsApp not delivered → SMS", async () => {
    await away();
    expect(await recordCallResult("appt-007", "Wants later today")).toBe(true); // Divya
    await sendPendingUpdates();
    expect((await info("appt-007")).state).toBe("WhatsApp not delivered → SMS");
  });

  it("the words “Update delivered” are never used", () => {
    for (const file of ["src/lib/whatsappStatus.ts", "src/app/page.tsx", "src/app/messages/page.tsx"]) {
      expect(readFileSync(join(process.cwd(), file), "utf8")).not.toMatch(/delivered \(WhatsApp\)/i);
    }
  });
});

describe("dashboard: “Needs staff call · holding [time]”", () => {
  it("shows the slot a Needs-staff-call patient still holds — and only then", async () => {
    await pushSneha();
    // Nikhil picked a time on a call, then asks for a person on WhatsApp.
    const booked = (await appt(NIKHIL)).startTime;
    await whatsapp(NIKHIL, "I want to talk to a person");
    const nikhil = await appt(NIKHIL);
    expect(nikhil.status).toBe("Needs staff call");
    expect(nikhil.startTime).toBe(booked); // the booking is kept
    expect(holdingLabel(nikhil)).toMatch(/^holding \d{1,2}:\d{2} (AM|PM)$/);
    // A pushed patient who replies "3" keeps their new time.
    await sendPendingUpdates();
    await whatsapp(SNEHA, "3");
    expect((await appt(SNEHA)).status).toBe("Needs staff call");
    expect(holdingLabel(await appt(SNEHA))).toBe("holding 12:15 PM");
    // Needs a staff call but never booked a new time → no "holding".
    await whatsapp("appt-009", "4");
    expect((await appt("appt-009")).status).toBe("Needs staff call");
    expect(holdingLabel(await appt("appt-009"))).toBe("");
  });
});

describe("Messages page: one channel label per update", () => {
  it("WhatsApp, SMS, and the three “WhatsApp fails” patients fall back to SMS", async () => {
    // 9:00 – 1:00, so all three "WhatsApp fails" patients are affected.
    await away("13:00");
    const ids = ["appt-001", "appt-002", "appt-007", "appt-009", "appt-013"];
    for (const id of ids) {
      expect(await recordCallResult(id, "Wants another day")).toBe(true);
      expect(await chooseOffer(id, 0)).toBe("booked");
    }
    await sendPendingUpdates();
    const sent = await getMessages();
    expect(sent).toHaveLength(ids.length); // one each, never both
    const label = (id: string) => messageChannelLabel(sent.find((m) => m.appointmentId === id)!);
    expect(label("appt-001")).toBe("WhatsApp");
    expect(label("appt-002")).toBe("SMS");
    for (const id of ["appt-007", "appt-009", "appt-013"]) {
      expect(label(id)).toBe("WhatsApp not delivered → sent by SMS");
      // Nothing went into their WhatsApp chat.
      expect((await appt(id)).whatsapp ?? []).toHaveLength(0);
    }
    const names = sent.map((m) => m.toName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("the page shows exactly one label per message", () => {
    const page = readFileSync(join(process.cwd(), "src/app/messages/page.tsx"), "utf8");
    expect(page.match(/data-channel=/g)).toHaveLength(1);
    expect(page).toContain("Simulated WhatsApp and text messages");
  });
});

// ---------- The first WhatsApp message ----------

// Words for the doctor's real reason, in all 3 languages (the call's wording).
const REASON_WORDS = [
  "surgery",
  "personal emergency",
  "அறுவை சிகிச்சை", // surgery (Tamil)
  "தனிப்பட்ட அவசர", // personal emergency (Tamil)
  "सर्जरी", // surgery (Hindi)
  "निजी इमरजेंसी", // personal emergency (Hindi)
];

// "Reply 5 …" in each language (not the 5 in a time like "5:00 PM").
const OPTION_5 = /Reply 5|5 என பதிலளிக்கவும்|5 भेजें/;

describe("the first WhatsApp message (privacy: hospital, doctor and time only)", () => {
  it("never has the patient's name, the visit reason or the doctor's reason — every doctor, every reason", async () => {
    const doctors = await getDoctors();
    let checked = 0;
    for (const doctor of doctors) {
      for (const reason of UNAVAILABILITY_REASONS) {
        steps = [];
        const u = await markDoctorUnavailable({
          doctorId: doctor.id,
          reason,
          fromTime: "09:00",
          untilTime: "17:00",
        });
        expect(u, `${doctor.id} ${reason}`).toBeTruthy();
        for (const a of await getAffectedAppointments(u!.id)) {
          if (!a.patient.whatsappOptIn) continue;
          await whatsapp(a.id, "hmm"); // saves DocDelay's first message
          const first = (await appt(a.id)).whatsapp![0];
          expect(first.from).toBe("docdelay");
          const text = first.text.toLowerCase();
          expect(text).not.toContain(a.patient.name.toLowerCase());
          // Each part of the name too — except a part the doctor's name also
          // has (e.g. Revathi KRISHNAN and Dr. Meera KRISHNAN), because the
          // message does name the doctor.
          for (const part of a.patient.name.toLowerCase().split(/\s+/)) {
            if (doctor.name.toLowerCase().includes(part)) continue;
            expect(text, `${a.id}: "${part}"`).not.toMatch(new RegExp(`\\b${part}\\b`));
          }
          expect(text).not.toContain(a.reason.toLowerCase());
          for (const word of REASON_WORDS) expect(text).not.toContain(word);
          expect(first.text).toMatch(/Reply|பதிலளிக்கவும்|भेजें/);
          expect(first.text).not.toMatch(/Press|அழுத்தவும்|दबाएँ/);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("all 3 languages, with and without option 5", () => {
    for (const language of ["English", "Tamil", "Hindi"] as Language[]) {
      for (const anotherDoctorToday of [true, false]) {
        const text = whatsappScript({
          language,
          hospitalName: "Sunrise Multispeciality Hospital",
          doctorName: "Dr. Meera Krishnan",
          appointmentTime: "10:00",
          untilTime: "12:00",
          anotherDoctorToday,
        });
        expect(text).toContain("Sunrise Multispeciality Hospital");
        expect(text).toContain("Dr. Meera Krishnan");
        for (const word of REASON_WORDS) expect(text.toLowerCase()).not.toContain(word);
        expect(text).not.toMatch(/Press|அழுத்தவும்|दबाएँ/);
        // Option 5 only when a slot is free.
        expect(OPTION_5.test(text), `${language} ${anotherDoctorToday}`).toBe(anotherDoctorToday);
      }
    }
    const english = whatsappScript({
      language: "English",
      hospitalName: "Sunrise Multispeciality Hospital",
      doctorName: "Dr. Meera Krishnan",
      appointmentTime: "10:00",
      untilTime: "12:00",
      anotherDoctorToday: true,
    });
    expect(english).toBe(
      "Hello, this is a message from Sunrise Multispeciality Hospital. " +
        "Dr. Meera Krishnan has been unexpectedly called away and won't be available at your 10:00 AM appointment. " +
        "The doctor expects to be back around 12:00 PM. " +
        "Would you like to: 1) wait for a later slot today, 2) move to another day, or 3) cancel? " +
        "Reply 4 to speak with our front desk. " +
        "Reply 5 to see another doctor from the same department today. " +
        "Reply with a number or tap an option.",
    );
  });

  it("the saved first WhatsApp message uses the new wording; the call's opening is unchanged", async () => {
    await away();
    // WhatsApp
    await whatsapp(NIKHIL, "hmm");
    const nikhil = await appt(NIKHIL);
    const doctor = (await getDoctors()).find((d) => d.id === "doc-cardio")!;
    expect(nikhil.whatsapp![0].text).toBe(
      whatsappScript({
        language: "English",
        hospitalName: (await getHospital()).name,
        doctorName: doctorNameFor(doctor, "English"),
        appointmentTime: "09:00",
        untilTime: "12:00",
        anotherDoctorToday: true,
      }),
    );
    // A chat on a call still starts with the call's wording (name, reason, "Press").
    const kiran = await appt(KIRAN);
    const understanding = await interpretWithRules("hmm", {
      language: kiran.patient.preferredLanguage,
      offers: [],
    });
    await sendChatMessage(KIRAN, "hmm", understanding);
    expect((await appt(KIRAN)).chat![0].text).toBe(
      callScript({
        language: "Hindi",
        patientName: kiran.patient.name,
        hospitalName: (await getHospital()).name,
        doctorName: doctorNameFor(doctor, "Hindi"),
        reason: "Emergency surgery",
        appointmentTime: "09:30",
        untilTime: "12:00",
        anotherDoctorToday: true,
      }),
    );
  });

  it("a doctor nobody covers for: no option 5 in the first message", async () => {
    const u = (await markDoctorUnavailable({
      doctorId: "doc-ortho",
      reason: "Personal emergency",
      fromTime: "09:00",
      untilTime: "17:00",
    }))!;
    const optedIn = (await getAffectedAppointments(u.id)).find((a) => a.patient.whatsappOptIn)!;
    await whatsapp(optedIn.id, "hmm");
    const first = (await appt(optedIn.id)).whatsapp![0].text;
    expect(first).not.toMatch(OPTION_5);
    expect(first).toMatch(/Reply 4|4 என பதிலளிக்கவும்|4 भेजें/);
  });

  it("the WhatsApp screen builds its first message with whatsappScript, not callScript", () => {
    const page = readFileSync(join(process.cwd(), "src/app/whatsapp/[id]/page.tsx"), "utf8");
    expect(page).toContain("whatsappScript(");
    expect(page).not.toContain("callScript(");
    expect(page).not.toContain("patientName");
  });
});

describe("patient details: the WhatsApp chat", () => {
  it("keeps what DocDelay heard in a voice note, and the panel shows the chat", async () => {
    await away();
    await whatsapp(NIKHIL, "naan wait panren", "voice");
    const turn = (await appt(NIKHIL)).whatsapp!.find((t) => t.from === "patient")!;
    expect(turn.media).toBe("voice");
    expect(turn.text).toBe("naan wait panren");
    const panel = readFileSync(join(process.cwd(), "src/app/PatientDetails.tsx"), "utf8");
    expect(panel).toContain("<WhatsAppTranscript turns={a.whatsapp}");
    const transcript = readFileSync(
      join(process.cwd(), "src/app/whatsapp/[id]/WhatsAppTranscript.tsx"),
      "utf8",
    );
    expect(transcript).toContain("Voice note · heard as:");
  });
});
