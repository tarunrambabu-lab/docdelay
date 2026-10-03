// Tests for the dashboard's WhatsApp labels (lib/whatsappStatus.ts) and the
// "holding [time]" label (lib/status.ts) — run with: npm test.
// These use small made-up appointments; src/app/whatsappPart3.test.ts runs
// the same labels through the real fake-HMS flows.
import { describe, expect, it } from "vitest";
import type { AppointmentWithPatient, ChatTurn, SmsMessage } from "@/hms/types";
import { holdingLabel } from "@/lib/status";
import {
  answerChannel,
  messageChannelLabel,
  photoNote,
  whatsappRowInfo,
  whatsappState,
} from "@/lib/whatsappStatus";

// A patient's appointment, affected by Dr. Meera's absence, still waiting.
function appt(changes: Partial<AppointmentWithPatient> = {}): AppointmentWithPatient {
  return {
    id: "appt-x",
    doctorId: "doc-cardio",
    patientId: "pat-x",
    dayOffset: 0,
    startTime: "10:00",
    endTime: "10:15",
    reason: "Routine heart check-up",
    status: "Affected – needs contact",
    unavailabilityId: "u-1",
    patient: {
      id: "pat-x",
      name: "Test Patient",
      phone: "+91 90000 00099",
      preferredLanguage: "English",
      whatsappOptIn: true,
    },
    ...changes,
  };
}
const at = (n: number) => `2026-10-03T03:30:0${n}.000Z`;
const patientSays = (n: number, media?: ChatTurn["media"]): ChatTurn => ({
  at: at(n),
  from: "patient",
  text: media === "photo" ? "" : "1",
  ...(media ? { media } : {}),
});
const docdelaySays = (n: number, text = "Thank you."): ChatTurn => ({
  at: at(n),
  from: "docdelay",
  text,
});
function message(changes: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: "sms-1",
    channel: "WhatsApp",
    sentAt: at(5),
    appointmentId: "appt-x",
    toName: "Test Patient",
    toPhone: "+91 90000 00099",
    language: "English",
    text: "UPDATE",
    ...changes,
  };
}

describe("WhatsApp state: whichever happened last", () => {
  it("waiting, nothing in the chat yet → WhatsApp sent", () => {
    expect(whatsappState(appt(), [])).toBe("WhatsApp sent");
  });

  it("the patient replied → Replied on WhatsApp", () => {
    const a = appt({ whatsapp: [docdelaySays(1), patientSays(2), docdelaySays(3)] });
    expect(whatsappState(a, [])).toBe("Replied on WhatsApp");
  });

  it("then the update went out on WhatsApp → Update sent (WhatsApp)", () => {
    const a = appt({
      status: "Rescheduled – later today",
      whatsapp: [docdelaySays(1), patientSays(2), docdelaySays(3), docdelaySays(5, "UPDATE")],
    });
    expect(whatsappState(a, [message()])).toBe("Update sent (WhatsApp)");
  });

  it("…and a reply to the update → Replied on WhatsApp again", () => {
    const a = appt({
      status: "Rescheduled – later today",
      whatsapp: [docdelaySays(5, "UPDATE"), patientSays(6), docdelaySays(7)],
    });
    expect(whatsappState(a, [message()])).toBe("Replied on WhatsApp");
  });

  it("the update couldn't go on WhatsApp → WhatsApp not delivered → SMS", () => {
    const a = appt({ status: "Rescheduled – later today", whatsapp: [patientSays(2)] });
    const failed = message({ channel: "SMS", whatsappFailed: true });
    expect(whatsappState(a, [failed])).toBe("WhatsApp not delivered → SMS");
  });

  it("STOP always wins, whatever came after", () => {
    const a = appt({
      status: "Rescheduled – later today",
      whatsappStopped: true,
      whatsapp: [patientSays(2), docdelaySays(5, "UPDATE")],
    });
    expect(whatsappState(a, [message()])).toBe("WhatsApp closed (STOP)");
    expect(whatsappState(a, [message({ channel: "SMS", whatsappFailed: true })])).toBe(
      "WhatsApp closed (STOP)",
    );
  });

  it("answered on a call, no update yet → no WhatsApp state", () => {
    expect(whatsappState(appt({ status: "Rescheduled – later today" }), [])).toBeUndefined();
  });

  it("never says “delivered” — only “sent”", () => {
    const labels = [
      whatsappState(appt(), []),
      whatsappState(
        appt({ status: "Cancelled", whatsapp: [docdelaySays(5, "UPDATE")] }),
        [message()],
      ),
    ];
    expect(labels).toEqual(["WhatsApp sent", "Update sent (WhatsApp)"]);
  });
});

describe("answer channel", () => {
  it("a call answer, then a WhatsApp “confirmed the update” → still Answered by call", () => {
    const a = appt({
      status: "Rescheduled – later today",
      callLog: [
        { calledAt: at(1), result: "Wants later today" },
        { calledAt: at(6), channel: "WhatsApp", detail: "WhatsApp: confirmed the update" },
      ],
    });
    expect(answerChannel(a)).toBe("Answered by call");
  });

  it("URGENT from WhatsApp, then a photo → Last reply on WhatsApp (not a choice)", () => {
    const a = appt({
      status: "URGENT – staff call now",
      callLog: [
        {
          calledAt: at(1),
          channel: "WhatsApp",
          detail: "WhatsApp: health concern mentioned → URGENT staff call",
        },
        { calledAt: at(2), channel: "WhatsApp", detail: "WhatsApp: photo received — not read" },
      ],
    });
    expect(answerChannel(a)).toBe("Last reply on WhatsApp");
  });

  it("no answer yet (waiting, or didn't pick up) → nothing", () => {
    expect(answerChannel(appt())).toBeUndefined();
    expect(
      answerChannel(appt({ status: "No answer", callLog: [{ calledAt: at(1), result: "No answer" }] })),
    ).toBeUndefined();
  });
});

describe("photo notes, Messages labels and “holding”", () => {
  it("photo note wording (one, several, none)", () => {
    expect(photoNote(1)).toBe("📷 WhatsApp: photo received — not read");
    expect(photoNote(3)).toBe("📷 WhatsApp: 3 photos received — not read");
    expect(photoNote(0)).toBe("");
    const a = appt({ whatsapp: [patientSays(1, "photo"), patientSays(2, "photo"), patientSays(3)] });
    expect(whatsappRowInfo(a, []).photos).toBe(2);
  });

  it("each message gets exactly one channel label", () => {
    expect(messageChannelLabel(message())).toBe("WhatsApp");
    expect(messageChannelLabel(message({ channel: "SMS" }))).toBe("SMS");
    expect(messageChannelLabel(message({ channel: "SMS", whatsappFailed: true }))).toBe(
      "WhatsApp not delivered → sent by SMS",
    );
  });

  it("“holding [time]” only for a Needs-staff-call patient with a booked new time", () => {
    const moved = {
      timeHistory: [
        {
          changedAt: at(1),
          oldDayOffset: 0,
          oldStartTime: "10:00",
          newDayOffset: 0,
          newStartTime: "14:15",
          why: "test",
        },
      ],
      startTime: "14:15",
    };
    expect(holdingLabel(appt({ status: "Needs staff call", ...moved }))).toBe("holding 2:15 PM");
    // Another day: the date too
    expect(holdingLabel(appt({ status: "Needs staff call", ...moved, dayOffset: 2 }))).toMatch(
      /^holding .+, 2:15 PM$/,
    );
    // No new time (still at the original, affected slot) → nothing
    expect(holdingLabel(appt({ status: "Needs staff call" }))).toBe("");
    // Other statuses → nothing
    expect(holdingLabel(appt({ status: "Rescheduled – later today", ...moved }))).toBe("");
    expect(holdingLabel(appt({ status: "URGENT – staff call now", ...moved }))).toBe("");
  });
});
