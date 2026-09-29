// Tests for the AI's day check (run with: npm test). No AI is used: these call
// the check directly with pretend AI searches.
import { describe, expect, it } from "vitest";
import type { AiTurnContext } from "@/hms/mockHms";
import { dateForDayOffset } from "@/lib/time";
import { aiContext } from "./aiInstructions";
import { correctNamedDay } from "./dayGuard";

// The next Thursday / Monday / Friday as day numbers (1 = tomorrow … 7).
const next = (weekday: number) =>
  [1, 2, 3, 4, 5, 6, 7].find((d) => dateForDayOffset(d).getUTCDay() === weekday)!;
const THU = next(4);
const MON = next(1);
const FRI = next(5);

describe("patient named a weekday, AI searched a different day → the named day is searched", () => {
  it.each(["guruvar 4 baje ke baad", "Vyazhan 4 mani mela", "Thursday after 4 PM"])(
    "%s",
    (message) => {
      const { input, correction } = correctNamedDay(message, {
        when: "other_days",
        days: [MON],
        after: "16:00",
      });
      expect(input).toEqual({ when: "other_days", days: [THU], after: "16:00" });
      expect(correction).toBeTruthy();
    },
  );

  it("AI searched today", () => {
    const { input, correction } = correctNamedDay("guruvar 4 baje ke baad", {
      when: "today",
      after: "16:00",
    });
    expect(input).toEqual({ when: "other_days", days: [THU], after: "16:00" });
    expect(correction).toContain("today");
  });

  it("AI searched every day (no days given)", () => {
    const { input } = correctNamedDay("guruvar 4 baje ke baad", { when: "other_days" });
    expect(input.days).toEqual([THU]);
  });

  it("two days named, AI searched neither", () => {
    const { input } = correctNamedDay("Thursday or Friday", { when: "other_days", days: [MON] });
    expect(input.days).toEqual([THU, FRI]);
  });
});

describe("left alone", () => {
  it("AI searched the named day", () => {
    const search = { when: "other_days", days: [THU], after: "16:00" };
    expect(correctNamedDay("guruvar 4 baje ke baad", search)).toEqual({ input: search });
  });

  it("two days named, AI searched one of them", () => {
    const search = { when: "other_days", days: [FRI] };
    expect(correctNamedDay("Thursday or Friday", search)).toEqual({ input: search });
  });

  it.each(["tomorrow morning", "I'll wait for a later time today", "after 4", "next week"])(
    "no weekday named: %s",
    (message) => {
      const search = { when: "other_days", days: [1] };
      expect(correctNamedDay(message, search)).toEqual({ input: search });
    },
  );

  // The named day is one to AVOID: keep the AI's choice.
  it.each([
    "next week but not Monday",
    "Thursday I'm busy",
    "I can't come on Thursday",
    "somvar nahi",
    "Thursday mudiyadhu",
    "any day except Monday",
  ])("patient avoids the named day: %s", (message) => {
    const search = { when: "other_days", days: [FRI] };
    expect(correctNamedDay(message, search)).toEqual({ input: search });
  });
});

describe("the AI's calendar", () => {
  it("shows each day's Tamil and Hindi weekday names", () => {
    const context = {
      calendar: [0, 1, 2, 3, 4, 5, 6, 7].map((d) => ({ day_offset: d, date: `day ${d}`, closed: false })),
      currentOffers: [],
    } as unknown as AiTurnContext;
    expect(aiContext(context)).toContain(
      `${THU} = day ${THU} (Tamil: vyazhan / viyazhan · Hindi: guruvar / veervar / brihaspativar)`,
    );
  });
});
