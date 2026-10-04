// Tests for the small "when is the doctor back?" helpers — run with: npm test.
import { describe, expect, it } from "vitest";
import { CLOCK_MODE, hospitalTimeNow } from "@/lib/clock";
import {
  bookingsStartAt,
  firstExpectedReturn,
  isReturnCheckDue,
  returnCheckCode,
} from "@/lib/returnCheck";

const change = (oldTime: string, newTime: string) => ({
  changedAt: "2026-10-04T04:00:00.000Z",
  oldTime,
  newTime,
});

describe("the first expected time and the time bookings start at", () => {
  it("never changed: both are the time that was entered", () => {
    const absence = { untilTime: "12:00" };
    expect(firstExpectedReturn(absence)).toBe("12:00");
    expect(bookingsStartAt(absence)).toBe("12:00");
  });

  it("a LATER time: bookings start at the new, later time", () => {
    const absence = { untilTime: "14:00", returnTimeChanges: [change("12:00", "14:00")] };
    expect(firstExpectedReturn(absence)).toBe("12:00");
    expect(bookingsStartAt(absence)).toBe("14:00");
  });

  it("an EARLIER time: bookings still start at the first expected time", () => {
    const absence = { untilTime: "11:00", returnTimeChanges: [change("12:00", "11:00")] };
    expect(firstExpectedReturn(absence)).toBe("12:00");
    expect(bookingsStartAt(absence)).toBe("12:00");
  });

  it("changed several times: the first time is still the one first entered", () => {
    const later = {
      untilTime: "15:00",
      returnTimeChanges: [change("12:00", "10:30"), change("10:30", "15:00")],
    };
    expect(firstExpectedReturn(later)).toBe("12:00");
    expect(bookingsStartAt(later)).toBe("15:00");
    // Later, then back to earlier than the first time: never before the first.
    const backDown = {
      untilTime: "11:30",
      returnTimeChanges: [change("12:00", "14:00"), change("14:00", "11:30")],
    };
    expect(bookingsStartAt(backDown)).toBe("12:00");
  });
});

describe("the “is the doctor back?” check", () => {
  it("is due from the expected return time on, not before", () => {
    expect(isReturnCheckDue({ untilTime: "12:00" }, "11:59")).toBe(false);
    expect(isReturnCheckDue({ untilTime: "12:00" }, "12:00")).toBe(true);
    expect(isReturnCheckDue({ untilTime: "12:00" }, "15:30")).toBe(true);
  });

  it("is never due once the doctor is marked available", () => {
    const absence = { untilTime: "12:00", markedAvailableAt: "2026-10-04T06:30:00.000Z" };
    expect(isReturnCheckDue(absence, "15:30")).toBe(false);
  });

  it("the clock is still the fixed demo clock, so the check never comes up by itself", () => {
    expect(CLOCK_MODE).toBe("demo");
    expect(hospitalTimeNow()).toBe("09:00");
    expect(isReturnCheckDue({ untilTime: "12:00" }, hospitalTimeNow())).toBe(false);
  });

  it("the demo link's marker names the absence and its current expected time", () => {
    expect(returnCheckCode({ id: "unavail-1", untilTime: "12:00" })).toBe("unavail-1_1200");
    // A new expected time gives a new marker, so an old link no longer shows the check.
    expect(returnCheckCode({ id: "unavail-1", untilTime: "14:00" })).not.toBe("unavail-1_1200");
  });
});
