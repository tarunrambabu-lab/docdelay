// Tests for the times "Mark doctor unavailable" starts with (run with: npm test).
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultUnavailableTimes } from "./unavailableDefaults";

// Pretend the real time is `iso` (UTC; India is UTC + 5:30).
function realTimeIs(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Mark doctor unavailable: starting times", () => {
  for (const iso of ["2026-09-30T21:30:00Z", "2026-10-01T09:07:00Z", "2026-10-01T18:20:00Z"]) {
    it(`demo clock: 9:00 AM – 12:00 PM whatever the real time (${iso})`, () => {
      realTimeIs(iso);
      expect(defaultUnavailableTimes(false)).toEqual({ fromTime: "09:00", untilTime: "12:00" });
    });
  }

  it("guided tour: 9:00 AM – 12:00 PM, as before", () => {
    realTimeIs("2026-10-01T09:07:00Z");
    expect(defaultUnavailableTimes(true)).toEqual({ fromTime: "09:00", untilTime: "12:00" });
  });

  it("real clock (not switched on): the next quarter-hour in India, for 3 hours", () => {
    realTimeIs("2026-10-01T09:07:00Z"); // 2:37 PM in India
    expect(defaultUnavailableTimes(false, "real")).toEqual({
      fromTime: "14:45",
      untilTime: "17:45",
    });
    realTimeIs("2026-10-01T18:20:00Z"); // 11:50 PM in India: never past 11:45 PM
    expect(defaultUnavailableTimes(false, "real")).toEqual({
      fromTime: "23:45",
      untilTime: "23:45",
    });
  });
});
