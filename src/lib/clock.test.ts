// Tests for the clock (run with: npm test).
// The computer's clock is faked to different real times; the demo clock must
// always say 9:00 AM, on today's date IN INDIA.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLOCK_MODE, hospitalTimeNow, hospitalToday, realTimestamp } from "./clock";
import { clockLabel, dateForDayOffset, formatClock } from "./time";

// Pretend the real time is `iso` (UTC).
function realTimeIs(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("demo clock", () => {
  it("is switched on", () => {
    expect(CLOCK_MODE).toBe("demo");
  });

  // [real time (UTC), real time in India, India's date]
  const cases: [string, string, string][] = [
    ["2026-09-30T21:30:00Z", "3:00 AM", "2026-10-01"],
    ["2026-10-01T09:07:00Z", "2:37 PM", "2026-10-01"],
    ["2026-10-01T18:20:00Z", "11:50 PM", "2026-10-01"],
    // Just after midnight in India, while it's still 1 Oct in London:
    ["2026-10-01T18:40:00Z", "12:10 AM", "2026-10-02"],
  ];
  for (const [iso, india, date] of cases) {
    it(`always 9:00 AM on India's date (real time ${india} in India)`, () => {
      realTimeIs(iso);
      expect(hospitalTimeNow()).toBe("09:00");
      expect(hospitalToday()).toBe(date);
      expect(dateForDayOffset(0).toISOString().slice(0, 10)).toBe(date);
      expect(clockLabel()).toBe("Demo time: 9:00 AM");
    });
  }

  it("shows every stored stamp as 9:00 AM, but keeps the stamp itself real", () => {
    realTimeIs("2026-10-01T18:20:00Z"); // 11:50 PM in India
    expect(realTimestamp()).toBe(Date.parse("2026-10-01T18:20:00Z"));
    expect(formatClock("2026-10-01T18:20:00Z")).toBe("9:00 AM");
    expect(formatClock("2026-10-01T18:20:05Z", { seconds: true })).toBe("9:00 AM");
  });
});

describe("real clock (not switched on — tested by asking for it)", () => {
  it("gives the real time in India", () => {
    realTimeIs("2026-10-01T20:30:00Z"); // 2:00 AM on 2 Oct in India
    expect(hospitalTimeNow("real")).toBe("02:00");
    expect(clockLabel("real")).toBe("Time now: 2:00 AM (India)");
    expect(formatClock("2026-10-01T05:10:05Z", { seconds: true }, "real")).toMatch(
      /^10:40:05\s?am$/i,
    );
  });
});

describe("one place for the time", () => {
  // Only clock.ts may read the computer's clock. The AI code's two stopwatches
  // (how long an AI reply takes) are the only exceptions.
  const ALLOWED = ["src/lib/clock.ts", "src/lib/understanding/claude.ts", "src/lib/understanding/aiChat.ts"];
  const READS_THE_CLOCK = /Date\.now\(\)|new Date\(\)|\.getHours\(\)|\.getMinutes\(\)/;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("no other file reads the computer's clock", () => {
    const root = join(__dirname, "..", "..");
    const offenders = sourceFiles(join(root, "src"))
      .map((path) => relative(root, path))
      .filter((path) => !ALLOWED.includes(path))
      .filter((path) => READS_THE_CLOCK.test(readFileSync(join(root, path), "utf8")));
    expect(offenders).toEqual([]);
  });
});
