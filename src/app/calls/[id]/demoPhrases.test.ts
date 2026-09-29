// Tests for the demo chat phrases (run with: npm test).
// Every phrase must give the right result in BASIC mode (the rule-based chat
// the live site uses), and the phrases must stay demo-only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { Language, SlotOffer } from "@/hms/types";
import { OFFER_LETTERS } from "@/lib/callScript";
import { dateForDayOffset, formatWhen } from "@/lib/time";
import { interpretWithRules, mentionsHealth } from "@/lib/understanding";
import { DEMO_PHRASES, offerPicks } from "./demoPhrases";

const LANGUAGES = Object.keys(DEMO_PHRASES) as Language[];
const understand = (message: string, language: Language, offers: SlotOffer[] = []) =>
  interpretWithRules(message, { language, offers });

// The next Thursday, as a day number (1 = tomorrow … 7).
const thursday = [1, 2, 3, 4, 5, 6, 7].find((d) => dateForDayOffset(d).getUTCDay() === 4);

// Three pretend offers on screen.
const THREE_OFFERS: SlotOffer[] = [
  { dayOffset: 2, startTime: "16:00" },
  { dayOffset: 3, startTime: "16:15" },
  { dayOffset: 5, startTime: "16:00" },
];

describe.each(LANGUAGES)("%s phrases in basic mode", (language) => {
  const { replies, symptom } = DEMO_PHRASES[language];

  it.each(replies)("$text → $intent", async ({ text, intent }) => {
    const understood = await understand(text, language);
    expect(understood.intent).toBe(intent);
    expect(mentionsHealth(text)).toBe(false);
    // The weekday-and-time phrase must also get the day and time right.
    if (intent === "another_day") {
      expect(understood.preferences.dayOffset).toBe(thursday);
      expect(understood.preferences.after).toBe("16:00");
    }
  });

  it(`symptom example "${symptom.text}" → URGENT`, async () => {
    expect(symptom.intent).toBe("health_concern");
    expect(mentionsHealth(symptom.text)).toBe(true);
    expect((await understand(symptom.text, language)).intent).toBe("health_concern");
  });

  // One pick button per offer on screen: A; A, B; or A, B, C. The button shows
  // the time ("A · Thu 1 Oct, 4:00 PM") but sends just the letter, which picks that offer.
  it.each([1, 2, 3])("with %i offer(s) on screen, each pick shows its time and picks it", async (count) => {
    const offers = THREE_OFFERS.slice(0, count);
    const picks = offerPicks(offers);
    expect(picks).toHaveLength(count);
    for (const [i, pick] of picks.entries()) {
      expect(pick.send).toBe(OFFER_LETTERS[i]);
      expect(pick.label).toBe(
        `${OFFER_LETTERS[i]} · ${formatWhen(offers[i].dayOffset, offers[i].startTime)}`,
      );
      const understood = await understand(pick.send, language, offers);
      expect(understood.intent).toBe("choose_offer");
      expect(understood.offerIndex).toBe(i);
    }
  });

  it("no offers on screen → no pick buttons", () => {
    expect(offerPicks([])).toEqual([]);
  });
});

describe("the phrase list", () => {
  it("covers later today, another day, cancel and talk to a person in every language", () => {
    for (const language of LANGUAGES) {
      expect(DEMO_PHRASES[language].replies.map((p) => p.intent).sort()).toEqual(
        ["another_day", "cancel", "later_today", "talk_to_person"].sort(),
      );
    }
  });

  it("gives every Tamil and Hindi phrase a short English meaning", () => {
    for (const language of ["Tamil", "Hindi"] as const) {
      const { replies, symptom } = DEMO_PHRASES[language];
      for (const phrase of [...replies, symptom]) expect(phrase.meaning).toBeTruthy();
    }
  });
});

// Demo-only: nothing but the simulator's chat box (and these tests) may use the phrases.
describe("demo-only", () => {
  it("only ChatBox.tsx imports demoPhrases", () => {
    const src = join(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(src);
    const importers = files
      .filter((f) => !/\.test\.tsx?$/.test(f) && !f.endsWith("demoPhrases.ts"))
      .filter((f) => /from ["'][^"']*demoPhrases["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(src, f));
    expect(importers).toEqual([join("app", "calls", "[id]", "ChatBox.tsx")]);
  });
});
