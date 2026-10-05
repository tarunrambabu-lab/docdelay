// Tests for the small "when is the doctor back?" helpers — run with: npm test.
import { describe, expect, it } from "vitest";
import { CLOCK_MODE, hospitalTimeNow } from "@/lib/clock";
import {
  bookingsStartAt,
  firstExpectedReturn,
  doctorBackAt,
  isReturnCheckDue,
  nextQuarterHour,
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

  it("the demo starts at 9:00 AM, so the check isn't due until the demo time is moved", () => {
    expect(CLOCK_MODE).toBe("demo");
    expect(hospitalTimeNow()).toBe("09:00");
    expect(isReturnCheckDue({ untilTime: "12:00" }, hospitalTimeNow())).toBe(false);
  });
});

describe("not before now: bookings never start at a time that has passed", () => {
  const absence = { untilTime: "12:00" };

  it("rounds now UP to the next quarter hour; a time on the quarter stays", () => {
    expect(nextQuarterHour("10:00")).toBe("10:00");
    expect(nextQuarterHour("10:01")).toBe("10:15");
    expect(nextQuarterHour("10:07")).toBe("10:15");
    expect(nextQuarterHour("10:15")).toBe("10:15");
    expect(nextQuarterHour("12:59")).toBe("13:00");
  });

  it("before the doctor is back: bookings start when the doctor is back", () => {
    expect(bookingsStartAt(absence, "09:00")).toBe("12:00");
    expect(bookingsStartAt(absence, "11:59")).toBe("12:00");
    expect(bookingsStartAt(absence, "12:00")).toBe("12:00");
  });

  it("after the doctor is back: bookings start at now, rounded up", () => {
    expect(bookingsStartAt(absence, "12:01")).toBe("12:15");
    expect(bookingsStartAt(absence, "13:00")).toBe("13:00");
    expect(bookingsStartAt(absence, "13:07")).toBe("13:15");
  });

  it("the latest of the first expected time, the current one, and now", () => {
    const later = { untilTime: "14:00", returnTimeChanges: [change("12:00", "14:00")] };
    const earlier = { untilTime: "10:00", returnTimeChanges: [change("12:00", "10:00")] };
    expect(bookingsStartAt(later, "13:00")).toBe("14:00");
    expect(bookingsStartAt(later, "15:20")).toBe("15:30");
    expect(bookingsStartAt(earlier, "10:30")).toBe("12:00");
    expect(bookingsStartAt(earlier, "12:40")).toBe("12:45");
  });

  it("when the doctor is back (what patients are told) never includes now", () => {
    const later = { untilTime: "14:00", returnTimeChanges: [change("12:00", "14:00")] };
    expect(doctorBackAt(absence)).toBe("12:00");
    expect(doctorBackAt(later)).toBe("14:00");
    expect(bookingsStartAt(absence)).toBe("12:00"); // without a time now: the same
  });
});
