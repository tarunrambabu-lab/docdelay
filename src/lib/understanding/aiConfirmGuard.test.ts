// Tests for the "AI says confirmed when nothing was booked" check
// (run with: npm test). FRD rule: confirmations only ever use DocDelay's fixed
// wording. NO real AI is called: the AI is replaced by a pretend one that uses
// the tools and replies exactly as each test says.
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

// The pretend AI: `script` uses the tools on the turn, then returns the reply.
let script: (turn: AiTurn) => string = () => "";
vi.mock("@/lib/understanding/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/understanding/claude")>()),
  runClaudeTurn: async (turn: AiTurn) => ({
    reply: script(turn),
    usage: { calls: 1, inputTokens: 0, outputTokens: 0 },
  }),
}));

import { getAppointment, markDoctorUnavailable, recordCallResult } from "@/hms/mockHms";
import type { Language } from "@/hms/types";
import {
  anotherDayReply,
  anotherDoctorOffersScript,
  anotherDoctorReply,
  callScript,
  laterTodayReply,
  otherDayOffersScript,
} from "@/lib/callScript";
import {
  askTodayOrAnotherDay,
  clinicHoursIntro,
  dayClosedPrefix,
  dayFullPrefix,
  doctorBackIntro,
  doctorBackNoneTodayPrefix,
  doctorBackNothingBeforePrefix,
  noFreeTodayPrefix,
  noMatchPrefix,
  noOtherDoctorFreeReply,
  unclearReply,
} from "@/lib/chatReplies";
import { aiChatTurn, claimsDone } from "./aiChat";

const LANGUAGES: Language[] = ["English", "Tamil", "Hindi"];

beforeEach(async () => {
  steps = [];
  vi.spyOn(console, "log").mockImplementation(() => {}); // quiet cost lines
  await markDoctorUnavailable({
    doctorId: "doc-cardio",
    reason: "Emergency surgery",
    fromTime: "09:00",
    untilTime: "12:00",
  });
  // appt-001 (English, 9:00 AM) is looking at Dr. Karthik's times
  await recordCallResult("appt-001", "Wants another doctor today");
});

describe("an AI reply that claims a booking that wasn't made is never shown", () => {
  it("a refused booking, then 'You're confirmed…' → not used; nothing saved", async () => {
    const before = [...steps];
    script = (turn) => {
      // 9:45 isn't one of Dr. Karthik's free slots → refused
      expect(turn.runTool("book_with_another_doctor", { start_time: "09:45" }).ok).toBe(false);
      return "You're confirmed for Dr. Karthik Raman, today, 9:30 AM.";
    };
    const result = await aiChatTurn("appt-001", "A");
    expect(result).toEqual({
      ok: false,
      reason: "reply sounds like a confirmation, but nothing was booked",
    });
    // (the caller then lets basic mode answer this message)
    expect(steps).toEqual(before);
    const appt = (await getAppointment("appt-001"))!;
    expect(appt.status).toBe("Affected – needs contact");
    expect(appt.doctorId).toBe("doc-cardio");
  });

  const CLAIMS: [Language, string][] = [
    ["English", "Your appointment is booked with Dr. Karthik Raman."],
    ["English", "Done — see you at the clinic."],
    ["English", "I've moved you to Dr. Karthik Raman. All sorted!"],
    ["English", "That's fixed for you."],
    ["Tamil", "உங்கள் சந்திப்பு உறுதிசெய்யப்பட்டது."],
    ["Tamil", "டாக்டர் கார்த்திக் ராமன் (Dr. Karthik Raman) உடன் புக் ஆகிவிட்டது."],
    ["Tamil", "Dr. Karthik kitta fix pannitten."],
    ["Tamil", "book pannitten, confirm aachu."],
    ["Tamil", "ungal appointment-a maathitten."],
    ["Hindi", "आपकी अपॉइंटमेंट पक्की हो गई है।"],
    ["Hindi", "डॉ. कार्तिक रमन के साथ बुक हो गया।"],
    ["Hindi", "maine fix kar diya hai."],
    ["Hindi", "ho gaya hai aapka, kar diya."],
  ];
  it.each(CLAIMS)("%s: %s → not used", async (_language, reply) => {
    expect(claimsDone(reply)).toBe(true);
    script = () => reply; // no tool called at all
    expect((await aiChatTurn("appt-001", "A")).ok).toBe(false);
    expect((await getAppointment("appt-001"))!.status).toBe("Affected – needs contact");
  });

  it("DocDelay's own confirmation lines count as claims if the AI writes them itself", () => {
    for (const language of LANGUAGES) {
      expect(claimsDone(laterTodayReply(language, "12:30"))).toBe(true);
      expect(claimsDone(anotherDayReply(language, 2, "10:15"))).toBe(true);
      expect(claimsDone(anotherDoctorReply(language, "09:30", "Dr. Karthik Raman"))).toBe(true);
    }
  });
});

describe("a real booking still gets DocDelay's fixed confirmation", () => {
  it("the AI books, whatever it writes → the fixed confirmation is shown", async () => {
    script = (turn) => {
      expect(turn.runTool("book_with_another_doctor", { start_time: "09:30" }).ok).toBe(true);
      return "Booked! See you at 9:30 AM."; // ignored: an outcome was recorded
    };
    expect(await aiChatTurn("appt-001", "A")).toEqual({ ok: true });
    const appt = (await getAppointment("appt-001"))!;
    expect(appt.status).toBe("Rebooked – another doctor");
    expect(appt.chat!.at(-1)!.text).toBe(
      anotherDoctorReply("English", "09:30", "Dr. Karthik Raman"),
    );
  });
});

describe("no false alarms: offers and questions still pass", () => {
  it("a normal AI reply offering times is used", async () => {
    script = (turn) => {
      turn.runTool("check_another_doctor_slots", {});
      return (
        "Another doctor from the same department can see you today: " +
        "A) Dr. Karthik Raman, today, 9:30 AM, B) Dr. Karthik Raman, today, 10:45 AM. Which would you like?"
      );
    };
    expect(await aiChatTurn("appt-001", "another doctor please")).toEqual({ ok: true });
  });

  const QUESTIONS = [
    // A real AI reply from the 1 Oct check ("Do you want to book this slot?")
    "क्या आप यह स्लॉट बुक करना चाहते हैं?",
    "Would you like me to book A, B or C?",
    "Shall I book 10:45 AM for you?",
    "Which time suits you: A, B or C?",
    "Can you confirm which option you'd like?",
    "எதை புக் செய்யட்டும்? A, B அல்லது C?",
    "A, B யா C — कौन सा समय बुक करूँ?",
  ];
  it.each(QUESTIONS)("question: %s", (reply) => {
    expect(claimsDone(reply)).toBe(false);
  });

  it("none of DocDelay's own offers, questions or explanations trip it", () => {
    const offers = [
      { dayOffset: 2, startTime: "10:15" },
      { dayOffset: 3, startTime: "16:00" },
    ];
    for (const language of LANGUAGES) {
      const lines = [
        callScript({
          language,
          patientName: "Nikhil Khan",
          hospitalName: "Sunrise Multispeciality Hospital",
          doctorName: "Dr. Meera Krishnan",
          reason: "Emergency surgery",
          appointmentTime: "09:00",
          untilTime: "12:00",
          anotherDoctorToday: true,
        }),
        otherDayOffersScript(language, offers, false),
        otherDayOffersScript(language, offers, true),
        anotherDoctorOffersScript(language, [
          { startTime: "09:30", doctorName: "Dr. Karthik Raman" },
          { startTime: "10:45", doctorName: "Dr. Karthik Raman" },
        ]),
        askTodayOrAnotherDay(language),
        unclearReply(language, false),
        unclearReply(language, true),
        noMatchPrefix(language),
        noFreeTodayPrefix(language),
        doctorBackIntro(language, "Dr. Meera Krishnan", "12:00"),
        doctorBackNoneTodayPrefix(language, "Dr. Meera Krishnan", "12:00"),
        doctorBackNothingBeforePrefix(language, "Dr. Meera Krishnan", "12:00", "11:00"),
        dayFullPrefix(language, 2),
        dayClosedPrefix(language, 3),
        clinicHoursIntro(language),
        noOtherDoctorFreeReply(language),
      ];
      for (const line of lines) expect([language, line, claimsDone(line)]).toEqual([language, line, false]);
    }
  });
});
