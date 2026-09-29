// Tests for the guided tour's steps (run with: npm test): wording, where each
// step points, when it moves on, and that every button it points at exists.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOUR_STEPS, TOUR_UNAVAILABLE, tourView, type TourScreen } from "./tourSteps";

const screen = (markers: string[], outcome?: string): TourScreen => ({
  markers: new Set(markers),
  outcome,
});
const step = (title: string) => TOUR_STEPS.findIndex((s) => s.title === title);

describe("wording", () => {
  it("has 6–8 steps, each with a title and text", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(6);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(8);
    for (const s of TOUR_STEPS) {
      expect(s.title).toBeTruthy();
      expect(s.text).toBeTruthy();
    }
  });

  it("never says 'safety net' or claims real phone calls", () => {
    for (const s of TOUR_STEPS) {
      expect(`${s.title} ${s.text}`).not.toMatch(/safety net/i);
      expect(`${s.title} ${s.text}`).not.toMatch(/real (phone )?calls?|real texts?/i);
    }
  });

  it("says the data is fictional and calls are simulated (first and last step)", () => {
    expect(TOUR_STEPS[0].text).toMatch(/fictional/);
    expect(TOUR_STEPS[0].text).toMatch(/simulated/);
    expect(TOUR_STEPS.at(-1)!.text).toMatch(/simulated/);
  });

  it("step 5 says 'flags them for an immediate staff call'", () => {
    const s = TOUR_STEPS[step("A patient mentions a symptom")];
    expect(s.text).toContain("flags them for an immediate staff call");
    expect(s.text).not.toContain("straight away");
  });

  it("step 6 tells phone visitors to scroll down for the \"was → now\" time", () => {
    expect(TOUR_STEPS[step("The staff call list")].text).toContain(
      "Scroll down to see the first patient's new time",
    );
  });

  it("the tour's pop-up times are 9:00 AM – 12:00 PM", () => {
    expect(TOUR_UNAVAILABLE).toEqual({ fromTime: "09:00", untilTime: "12:00" });
  });
});

describe("where each step points, and when it moves on", () => {
  it("2: Mark doctor unavailable → Mark unavailable → done when the banner appears", () => {
    const i = step("A doctor is called away");
    expect(tourView(i, screen(["mark-unavailable"])).target).toBe("mark-unavailable");
    expect(tourView(i, screen(["mark-unavailable", "confirm-unavailable"])).target).toBe(
      "confirm-unavailable",
    );
    expect(tourView(i, screen(["banner", "mark-unavailable"])).done).toBe(true);
  });

  it("3: points at the appointment list; moves on with Next", () => {
    const i = step("Affected patients turn red");
    expect(tourView(i, screen(["banner", "appointments"])).target).toBe("appointments");
    expect(TOUR_STEPS[i].nextLabel).toBe("Next");
  });

  it("4: Start calling → Chat → the 'I'll wait' reply → done when there's an outcome", () => {
    const i = step("Talk to the first patient");
    expect(tourView(i, screen(["banner", "start-calling"])).target).toBe("start-calling");
    expect(tourView(i, screen(["back-to-dashboard", "chat-tab"])).target).toBe("chat-tab");
    expect(tourView(i, screen(["chat-tab", "chat-box", "reply-later_today"])).target).toBe(
      "reply-later_today",
    );
    // No room today → other-day offers appear: point at the first pick instead
    expect(
      tourView(i, screen(["chat-tab", "chat-box", "offer-pick", "reply-later_today"])).target,
    ).toBe("offer-pick");
    expect(tourView(i, screen(["next-patient"], "Rescheduled – later today")).done).toBe(true);
  });

  it("5: Next patient → the symptom example → done when URGENT", () => {
    const i = step("A patient mentions a symptom");
    expect(tourView(i, screen(["next-patient"], "Rescheduled – later today")).target).toBe(
      "next-patient",
    );
    expect(tourView(i, screen(["chat-box", "symptom-example"])).target).toBe("symptom-example");
    expect(tourView(i, screen(["next-patient"], "Rescheduled – later today")).done).toBe(false);
    expect(tourView(i, screen(["next-patient"], "URGENT – staff call now")).done).toBe(true);
  });

  it("6: Back to dashboard → the staff call list; Next only once the list is on screen", () => {
    const i = step("The staff call list");
    expect(tourView(i, screen(["back-to-dashboard"])).target).toBe("back-to-dashboard");
    expect(tourView(i, screen(["back-to-dashboard"])).ready).toBe(false);
    expect(tourView(i, screen(["staff-list", "banner"])).target).toBe("staff-list");
    expect(tourView(i, screen(["staff-list", "banner"])).ready).toBe(true);
  });

  it("7: Messages → Send updates → done when a text is sent", () => {
    const i = step("One text per patient");
    expect(tourView(i, screen(["back-to-dashboard"])).target).toBe("back-to-dashboard");
    expect(tourView(i, screen(["messages-link", "staff-list"])).target).toBe("messages-link");
    expect(tourView(i, screen(["send-updates"])).target).toBe("send-updates");
    expect(tourView(i, screen(["sent-message"])).done).toBe(true);
  });

  it("wandered off (the button isn't on screen) → 'Take me back'", () => {
    const i = step("A doctor is called away");
    expect(tourView(i, screen(["send-updates"]))).toEqual({
      target: undefined,
      done: false,
      lost: true,
      ready: true,
    });
  });

  it("the first and last steps point at nothing and are never 'lost'", () => {
    for (const i of [0, TOUR_STEPS.length - 1]) {
      expect(tourView(i, screen([]))).toEqual({
        target: undefined,
        done: false,
        lost: false,
        ready: true,
      });
    }
  });
});

// Every marker the tour looks for must exist on a real page, so a future change
// can't silently break a step.
describe("every button the tour points at exists", () => {
  const src = join(process.cwd(), "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(name)) files.push(path);
    }
  };
  walk(src);
  const pages = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const tourSource = readFileSync(join(src, "app", "tour", "tourSteps.ts"), "utf8");
  const markers = [...new Set([...tourSource.matchAll(/markers\.has\("([^"]+)"\)/g)].map((m) => m[1]))];
  markers.push("outcome"); // read directly by the tour card

  it.each(markers)("%s", (marker) => {
    if (marker.startsWith("reply-")) {
      // The reply buttons get "reply-<intent>" from the phrase list
      expect(pages).toContain("`reply-${p.intent}`");
    } else {
      expect(pages).toMatch(new RegExp(`data-tour=\\{?"${marker}"|"${marker}"`));
    }
  });
});
