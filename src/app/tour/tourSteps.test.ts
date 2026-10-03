// Tests for the guided tour's steps (run with: npm test): wording, where each
// step points, when it moves on, and that every button it points at exists.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TOUR_STEPS,
  TOUR_UNAVAILABLE,
  TOUR_WHATSAPP_APPOINTMENT,
  tourView,
  type TourScreen,
} from "./tourSteps";

const screen = (markers: string[], outcome?: string): TourScreen => ({
  markers: new Set(markers),
  outcome,
});
const step = (title: string) => TOUR_STEPS.findIndex((s) => s.title === title);

describe("wording", () => {
  it("has 6–10 steps, each with a title and text", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(6);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(10);
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

  it("the welcome mentions seeing another doctor today", () => {
    expect(TOUR_STEPS[0].text).toContain("cancel, or see another doctor today");
  });

  it("the another-doctor step comes right after the symptom step", () => {
    expect(step("Another doctor, same day")).toBe(step("A patient mentions a symptom") + 1);
  });

  it("the WhatsApp step is step 7, right after the another-doctor step, and says the chat is in Tamil", () => {
    const i = step("Patients can also answer on WhatsApp");
    expect(i).toBe(6); // step 7 of 10
    expect(i).toBe(step("Another doctor, same day") + 1);
    expect(TOUR_STEPS[i].text).toContain("Revathi Krishnan");
    expect(TOUR_STEPS[i].text).toContain("Her messages are in Tamil; the buttons are in English.");
    expect(TOUR_WHATSAPP_APPOINTMENT).toBe("appt-005");
  });

  it("step 9 says one update per patient, on WhatsApp or by text", () => {
    const s = TOUR_STEPS[step("One update per patient")];
    expect(s.text).toContain("on WhatsApp if they agreed to it, otherwise by text");
    expect(step("One text per patient")).toBe(-1);
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

  it("6: Next patient → Buttons → 5 → a Karthik time → the result, then Next", () => {
    const i = step("Another doctor, same day");
    const at = (markers: string[], outcome?: string) => tourView(i, screen(markers, outcome));
    // Starts on the symptom patient's finished chat
    expect(at(["next-patient", "outcome"], "URGENT – staff call now").target).toBe("next-patient");
    // The next patient opens in Chat
    expect(at(["chat-tab", "buttons-tab", "chat-box"]).target).toBe("buttons-tab");
    // Buttons: "5 – Another doctor today"
    expect(at(["chat-tab", "buttons-tab", "another-doctor"]).target).toBe("another-doctor");
    // Times with Dr. Karthik
    expect(at(["chat-tab", "buttons-tab", "another-doctor-pick"]).target).toBe(
      "another-doctor-pick",
    );
    // Booked: ring around the "was → now" result, and only now the Next button
    const booked = at(["outcome", "next-patient"], "Rebooked – another doctor");
    expect(booked.target).toBe("outcome");
    expect(booked.ready).toBe(true);
    expect(booked.lost).toBe(false);
    expect(at(["chat-tab", "buttons-tab", "another-doctor"]).ready).toBe(false);
    expect(TOUR_STEPS[i].nextLabel).toBe("Next");
    // Never "lost" along the way
    for (const markers of [["chat-tab", "buttons-tab", "chat-box"], ["buttons-tab", "another-doctor"]]) {
      expect(at(markers).lost).toBe(false);
    }
  });

  it("6: pressing anything other than 5 moves the ring on to the next patient", () => {
    const i = step("Another doctor, same day");
    const at = (markers: string[], outcome?: string) => tourView(i, screen(markers, outcome));
    // 1 – Later today → the result, with "Next patient"
    expect(at(["outcome", "next-patient"], "Rescheduled – later today").target).toBe(
      "next-patient",
    );
    // 2 – Another day (or 1 with no room today) → the first other-day time
    expect(at(["buttons-tab", "day-offer-pick"]).target).toBe("day-offer-pick");
    // …then its result → "Next patient"
    expect(at(["outcome", "next-patient"], "Rescheduled – another day").target).toBe(
      "next-patient",
    );
    // 3 / 4 / Didn't pick up → straight to the next patient's buttons
    expect(at(["buttons-tab", "another-doctor"]).target).toBe("another-doctor");
    // Wandered to the dashboard → "Start calling patients"
    expect(at(["banner", "start-calling"]).target).toBe("start-calling");
  });

  it("7: Back to dashboard → Revathi's “Open WhatsApp” → “1 – Later today” → done when answered", () => {
    const i = step("Patients can also answer on WhatsApp");
    const at = (markers: string[]) => tourView(i, screen(markers));
    // Starts on the call screen (after the another-doctor booking)
    expect(at(["back-to-dashboard", "outcome", "next-patient"]).target).toBe("back-to-dashboard");
    // The dashboard: Revathi's link (other rows' links carry no marker)
    expect(at(["banner", "staff-list", "tour-whatsapp-link"]).target).toBe("tour-whatsapp-link");
    // Her WhatsApp screen: "1 – Later today"
    expect(at(["back-to-dashboard", "whatsapp-later-today"]).target).toBe("whatsapp-later-today");
    // No room today: the first other-day time
    expect(at(["back-to-dashboard", "whatsapp-offer-pick"]).target).toBe("whatsapp-offer-pick");
    // Her answer is saved → done
    expect(at(["back-to-dashboard", "whatsapp-answered"]).done).toBe(true);
    expect(at(["back-to-dashboard", "whatsapp-later-today"]).done).toBe(false);
    // Never "lost" along the way
    for (const markers of [["back-to-dashboard"], ["tour-whatsapp-link"], ["whatsapp-later-today"]]) {
      expect(at(markers).lost).toBe(false);
    }
  });

  it("8: coming back from WhatsApp with the details panel open → “Close” first", () => {
    const i = step("The staff call list");
    const open = tourView(i, screen(["staff-list", "banner", "close-details"]));
    expect(open.target).toBe("close-details");
    expect(open.ready).toBe(false); // no "Next" until the list can be seen
    const closed = tourView(i, screen(["staff-list", "banner"]));
    expect(closed.target).toBe("staff-list");
    expect(closed.ready).toBe(true);
  });

  it("8: Back to dashboard → the staff call list; Next only once the list is on screen", () => {
    const i = step("The staff call list");
    expect(tourView(i, screen(["back-to-dashboard"])).target).toBe("back-to-dashboard");
    expect(tourView(i, screen(["back-to-dashboard"])).ready).toBe(false);
    expect(tourView(i, screen(["staff-list", "banner"])).target).toBe("staff-list");
    expect(tourView(i, screen(["staff-list", "banner"])).ready).toBe(true);
  });

  it("9: Messages → Send updates → done when an update is sent", () => {
    const i = step("One update per patient");
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
