// Tests for "5 – Another doctor today" (Buttons mode only) — run with: npm test.
//
// These run the real code in the fake HMS. As in unclearReplies.test.ts, the
// only thing swapped out is where a visitor's demo history is kept.
//
// The mock hospital (mockData.json): Dr. Karthik Raman (doc-cardio-2) is a
// second cardiologist, approved to cover for Dr. Meera Krishnan (doc-cardio).
// His EMPTY slots today: 9:30, 10:45, 11:30, 1:15, 2:30, 3:45, 4:30.
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
  getAnotherDoctorOptions,
  getAppointment,
  getAppointmentsForDay,
  getAppointmentsMovedAwayFrom,
  getDoctors,
  getMessages,
  getPendingUpdates,
  markDoctorUnavailable,
  recordCallResult,
  sendChatMessage,
  sendPendingUpdates,
} from "@/hms/mockHms";
import type { Appointment } from "@/hms/types";
import {
  anotherDoctorOffersScript,
  anotherDoctorReply,
  callScript,
  type CallScriptDetails,
} from "@/lib/callScript";
import { findAnotherDoctorSlots } from "@/lib/reschedulingRules";
import { callSummary, describeTimeChange } from "@/lib/status";
import { fromMinutes } from "@/lib/time";
import { interpretWithRules } from "@/lib/understanding";

const MEERA = "doc-cardio";
const KARTHIK = "doc-cardio-2";

const away = (fromTime: string, untilTime: string) =>
  markDoctorUnavailable({ doctorId: MEERA, reason: "Emergency surgery", fromTime, untilTime });

// The patient presses 5, then picks offer `letter` (0 = A).
async function pressFiveAndPick(appointmentId: string, letter = 0) {
  expect(await recordCallResult(appointmentId, "Wants another doctor today")).toBe(true);
  return chooseOffer(appointmentId, letter);
}

const times = (offers: { startTime: string }[]) => offers.map((o) => o.startTime);

beforeEach(() => {
  steps = [];
});

describe("which slots are offered", () => {
  it("up to 3 empty slots with Dr. Karthik, at or after the original time, earliest first", async () => {
    await away("09:00", "12:00");
    // appt-001 was at 9:00; appt-010 at 11:45.
    const early = await getAnotherDoctorOptions("appt-001");
    expect(times(early)).toEqual(["09:30", "10:45", "11:30"]);
    expect(early.every((o) => o.doctorId === KARTHIK && o.dayOffset === 0)).toBe(true);
    expect(times(await getAnotherDoctorOptions("appt-010"))).toEqual(["13:15", "14:30", "15:45"]);
  });

  it("every slot ends by 5:00 PM", async () => {
    await away("15:30", "17:00");
    // appt-021 was at 3:30 PM: only 3:45 and 4:30 are left (4:45 is booked).
    expect(times(await getAnotherDoctorOptions("appt-021"))).toEqual(["15:45", "16:30"]);
  });

  it("only approved doctors of the SAME specialty — even if the list is wrong", async () => {
    // Pretend someone wrongly listed the orthopaedist (free at 9:45 today).
    const ortho = startingData.doctors.find((d) => d.id === "doc-ortho")! as {
      canCoverFor?: string[];
    };
    ortho.canCoverFor = [MEERA];
    try {
      await away("09:00", "12:00");
      const offers = await getAnotherDoctorOptions("appt-001");
      expect(offers.map((o) => o.doctorId)).toEqual([KARTHIK, KARTHIK, KARTHIK]);
    } finally {
      delete ortho.canCoverFor;
    }
  });

  it("the rule on its own: at/after the original time, by 5 PM, first-listed doctor wins a tie", () => {
    // Doctor X: booked all day except 16:45. Doctor Y: booked all day except 16:30 and 16:45.
    const allDay = (doctorId: string, except: string[]) => {
      const list: Appointment[] = [];
      for (let m = 9 * 60; m < 17 * 60; m += 15) {
        const startTime = fromMinutes(m);
        if (except.includes(startTime)) continue;
        list.push({
          id: `${doctorId}-${startTime}`,
          doctorId,
          patientId: "p",
          dayOffset: 0,
          startTime,
          endTime: fromMinutes(m + 15),
          reason: "",
          status: "Scheduled",
        });
      }
      return list;
    };
    const offers = findAnotherDoctorSlots("16:20", [
      { doctorId: "X", appointments: allDay("X", ["16:45"]) },
      { doctorId: "Y", appointments: allDay("Y", ["16:30", "16:45"]) },
    ]);
    expect(offers).toEqual([
      { dayOffset: 0, startTime: "16:30", doctorId: "Y" },
      { dayOffset: 0, startTime: "16:45", doctorId: "X" }, // tie at 16:45: X is listed first
      { dayOffset: 0, startTime: "16:45", doctorId: "Y" },
    ]);
    // Nothing starts before the original time; nothing after 5 PM exists.
    expect(findAnotherDoctorSlots("17:00", [{ doctorId: "X", appointments: [] }])).toEqual([]);
  });
});

describe("option hidden when there's no slot", () => {
  it("no empty slot with an approved doctor → no option, and pressing 5 anyway records nothing", async () => {
    await away("16:45", "17:00");
    // appt-023 was at 4:45 PM; Dr. Karthik's 4:45 is booked.
    expect(await getAnotherDoctorOptions("appt-023")).toEqual([]);
    expect(await recordCallResult("appt-023", "Wants another doctor today")).toBe(false);
    const appt = (await getAppointment("appt-023"))!;
    expect(appt.status).toBe("Affected – needs contact");
    expect(appt.callLog).toBeUndefined();
  });

  it("the opening message only mentions 5 when asked to", () => {
    const details: CallScriptDetails = {
      language: "English",
      patientName: "Nikhil Khan",
      hospitalName: "Sunrise Multispeciality Hospital",
      doctorName: "Dr. Meera Krishnan",
      reason: "Emergency surgery",
      appointmentTime: "11:00",
      untilTime: "12:00",
    };
    expect(callScript(details)).not.toContain("5");
    expect(callScript({ ...details, anotherDoctorToday: true })).toMatch(
      /Press 4 to speak with our front desk\. Press 5 to see another doctor from the same department today\.$/,
    );
  });
});

describe("booking", () => {
  it("books the slot, frees the original one, and shows up on Dr. Karthik's schedule", async () => {
    await away("09:00", "12:00");
    expect(await pressFiveAndPick("appt-001")).toBe("booked");

    const appt = (await getAppointment("appt-001"))!;
    expect(appt.status).toBe("Rebooked – another doctor");
    expect(appt.doctorId).toBe(KARTHIK);
    expect(appt.startTime).toBe("09:30");
    expect(appt.offers).toBeUndefined();
    expect(describeTimeChange(appt, await getDoctors())).toBe(
      "was 9:00 AM, Dr. Meera Krishnan → now 9:30 AM, Dr. Karthik Raman",
    );

    // Dr. Meera's 9:00 slot is free; the patient is still listed there as "moved away".
    const meeraToday = await getAppointmentsForDay(MEERA, 0);
    expect(meeraToday.some((a) => a.id === "appt-001")).toBe(false);
    expect((await getAppointmentsMovedAwayFrom(MEERA, 0)).map((a) => a.id)).toContain("appt-001");
    // …and it's on Dr. Karthik's schedule at 9:30 (not listed as moved away from him).
    const karthikToday = await getAppointmentsForDay(KARTHIK, 0);
    expect(karthikToday.find((a) => a.id === "appt-001")?.startTime).toBe("09:30");
    expect(await getAppointmentsMovedAwayFrom(KARTHIK, 0)).toEqual([]);

    expect(callSummary([appt.status])).toBe("1 called: 1 another doctor");
  });

  it("slot taken just before booking → refused, fresh options, and 'Sorry, that time was just taken'", async () => {
    await away("09:00", "12:00");
    // Both patients are offered Dr. Karthik's 9:30 first.
    await recordCallResult("appt-001", "Wants another doctor today");
    await recordCallResult("appt-002", "Wants another doctor today");
    expect(times((await getAppointment("appt-002"))!.offers!)).toEqual(["09:30", "10:45", "11:30"]);

    expect(await chooseOffer("appt-001", 0)).toBe("booked"); // takes 9:30
    expect(await chooseOffer("appt-002", 0)).toBe("taken"); // 9:30 is gone

    const second = (await getAppointment("appt-002"))!;
    expect(second.status).toBe("Affected – needs contact");
    expect(second.doctorId).toBe(MEERA);
    expect(second.slotJustTaken).toBe(true);
    expect(times(second.offers!)).toEqual(["10:45", "11:30", "13:15"]);
    // Only ONE patient ended up at 9:30 with Dr. Karthik.
    const at930 = (await getAppointmentsForDay(KARTHIK, 0)).filter((a) => a.startTime === "09:30");
    expect(at930.map((a) => a.id)).toEqual(["appt-001"]);
  });

  it("slot taken and nothing left → back to the 1–4 menu (no option 5), with the sorry line", async () => {
    await away("15:30", "17:00");
    // appt-022 (4:30 PM) can only get 4:30. appt-021 (3:30 PM) takes it first.
    await recordCallResult("appt-022", "Wants another doctor today");
    expect(times((await getAppointment("appt-022"))!.offers!)).toEqual(["16:30"]);
    await recordCallResult("appt-021", "Wants another doctor today");
    expect(await chooseOffer("appt-021", 1)).toBe("booked"); // B = 4:30

    expect(await chooseOffer("appt-022", 0)).toBe("taken");
    const appt = (await getAppointment("appt-022"))!;
    expect(appt.status).toBe("Affected – needs contact");
    expect(appt.offers).toBeUndefined();
    expect(appt.offersBecause).toBeUndefined();
    expect(appt.slotJustTaken).toBe(true);
    expect(await getAnotherDoctorOptions("appt-022")).toEqual([]);

    // The 1–4 menu still works, and answering clears the sorry line.
    expect(await recordCallResult("appt-022", "Cancelled")).toBe(true);
    const after = (await getAppointment("appt-022"))!;
    expect(after.status).toBe("Cancelled");
    expect(after.slotJustTaken).toBeUndefined();
  });

  it("'None of these – call me' → staff call", async () => {
    await away("09:00", "12:00");
    await recordCallResult("appt-001", "Wants another doctor today");
    expect(await chooseOffer("appt-001", null)).toBe("none");
    const appt = (await getAppointment("appt-001"))!;
    expect(appt.status).toBe("Needs staff call");
    expect(appt.note).toBe("Wanted another doctor today");
    expect(appt.doctorId).toBe(MEERA);
  });

  it("Dr. Karthik's own patients are never moved", async () => {
    const snapshot = async () =>
      JSON.stringify(
        (
          await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((d) => getAppointmentsForDay(KARTHIK, d)))
        )
          .flat()
          .filter((a) => a.id.startsWith("appt-") && Number(a.id.slice(5)) > 490),
      );
    const before = await snapshot();

    await away("09:00", "17:00");
    for (const id of ["appt-001", "appt-002", "appt-003", "appt-010", "appt-021"]) {
      await pressFiveAndPick(id);
    }
    expect(await snapshot()).toBe(before);
  });
});

describe("one text per patient, naming the new doctor and time, in their language", () => {
  it("English, Tamil and Hindi", async () => {
    await away("09:00", "12:00");
    // appt-001 English → 9:30; appt-002 Tamil → 10:45; appt-003 Hindi → 11:30.
    for (const id of ["appt-001", "appt-002", "appt-003"]) {
      expect(await pressFiveAndPick(id)).toBe("booked");
    }
    const pending = await getPendingUpdates();
    expect(pending.map((u) => u.appointmentId).sort()).toEqual(["appt-001", "appt-002", "appt-003"]);

    expect(await sendPendingUpdates()).toBe(3);
    const messages = await getMessages();
    const textFor = (id: string) => {
      const mine = messages.filter((m) => m.appointmentId === id);
      expect(mine).toHaveLength(1); // exactly one text
      return mine[0].text;
    };

    expect(textFor("appt-001")).toBe(
      "Sunrise Multispeciality Hospital: your appointment is now with Dr. Karthik Raman " +
        "(instead of Dr. Meera Krishnan) at 9:30 AM today due to an emergency. " +
        "Reply 1 to confirm, 2 to change.",
    );
    const tamil = textFor("appt-002");
    expect(tamil).toContain("டாக்டர் கார்த்திக் ராமன் (Dr. Karthik Raman) உடன்");
    expect(tamil).toContain("டாக்டர் மீரா கிருஷ்ணன் (Dr. Meera Krishnan) அவர்களுக்குப் பதிலாக");
    expect(tamil).toContain("இன்று காலை 10:45 (10:45 AM) மணிக்கு");
    const hindi = textFor("appt-003");
    expect(hindi).toContain("डॉ. मीरा कृष्णन (Dr. Meera Krishnan) की जगह");
    expect(hindi).toContain("डॉ. कार्तिक रमन (Dr. Karthik Raman) के साथ");
    expect(hindi).toContain("आज सुबह 11:30 (11:30 AM) पर है।");
    expect(await getPendingUpdates()).toEqual([]);
  });
});

describe("patient wording", () => {
  it("offers and confirmation (English)", () => {
    const offers = ["11:30", "13:15", "14:30"].map((startTime) => ({
      startTime,
      doctorName: "Dr. Karthik Raman",
    }));
    expect(anotherDoctorOffersScript("English", offers)).toBe(
      "Another doctor from the same department can see you today: " +
        "A) Dr. Karthik Raman, 11:30 AM, B) Dr. Karthik Raman, 1:15 PM, C) Dr. Karthik Raman, 2:30 PM. " +
        "Please choose A, B or C. If none of these suit you, our front desk will call you.",
    );
    expect(anotherDoctorReply("English", "11:30", "Dr. Karthik Raman")).toBe(
      "Thank you. Your new appointment is today at 11:30 AM with Dr. Karthik Raman.",
    );
  });
});

describe("chat mode is unchanged", () => {
  afterEach(() => {
    steps = [];
  });

  it("the chat opening never mentions option 5", async () => {
    await away("09:00", "12:00");
    const appt = (await getAppointment("appt-001"))!;
    const understanding = await interpretWithRules("hmm", {
      language: appt.patient.preferredLanguage,
      offers: [],
    });
    await sendChatMessage("appt-001", "hmm", understanding);
    const opening = (await getAppointment("appt-001"))!.chat![0].text;
    expect(opening).toContain("Press 4 to speak with our front desk.");
    expect(opening).not.toContain("5");
  });

  it("the chat won't take over a patient who is choosing another doctor", async () => {
    await away("09:00", "12:00");
    await recordCallResult("appt-001", "Wants another doctor today");
    const understanding = await interpretWithRules("A", { language: "English", offers: [] });
    expect(await sendChatMessage("appt-001", "A", understanding)).toBe(false);
    expect((await getAppointment("appt-001"))!.doctorId).toBe(MEERA);
  });
});
