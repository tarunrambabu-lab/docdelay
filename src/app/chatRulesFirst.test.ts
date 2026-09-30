// Tests for Chat mode with the AI switched on (run with: npm test): basic
// mode's reading wins over the AI for "another doctor", like the health check.
// NO real AI is called: a pretend AI stands in. It "misses" another-doctor
// requests (as the real AI did once with "vera doctor paakanum" on 2 Oct 2026)
// and counts how often it's asked.
import { beforeEach, describe, expect, it, vi } from "vitest";
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

// Next.js page helpers (not needed outside a real server)
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
// The AI is "on", with no spending limit reached
vi.mock("@/lib/understanding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/understanding")>()),
  activeEngine: () => "claude",
}));
vi.mock("@/lib/understanding/usage", () => ({ countOneAiMessage: async () => "ok" }));

// The pretend AI: never uses a tool, just offers the usual three choices.
let aiCalls = 0;
vi.mock("@/lib/understanding/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/understanding/claude")>()),
  runClaudeTurn: async () => {
    aiCalls++;
    return {
      reply: "Would you like to wait for a later time today, move to another day, or cancel?",
      usage: { calls: 1, inputTokens: 0, outputTokens: 0 },
    };
  },
}));

import { chatAction } from "@/app/actions";
import { getAppointment, markDoctorUnavailable } from "@/hms/mockHms";

beforeEach(async () => {
  steps = [];
  aiCalls = 0;
  vi.spyOn(console, "log").mockImplementation(() => {}); // quiet cost lines
  await markDoctorUnavailable({
    doctorId: "doc-cardio",
    reason: "Emergency surgery",
    fromTime: "09:00",
    untilTime: "12:00",
  });
});

describe("basic mode's 'another doctor' reading wins over the AI", () => {
  // appt-001 English, appt-002 Tamil, appt-003 Hindi
  it.each([
    ["appt-002", "vera doctor paakanum"],
    ["appt-002", "வேறு டாக்டர் பார்க்கணும்"],
    ["appt-003", "doosre doctor se milna hai"],
    ["appt-003", "दूसरे डॉक्टर से मिलना है"],
    ["appt-001", "another doctor please"],
    ["appt-001", "5"],
  ])("%s: %s → Dr. Karthik's times, and the AI isn't asked", async (id, text) => {
    await chatAction(id, text);
    expect(aiCalls).toBe(0);
    const appt = (await getAppointment(id))!;
    expect(appt.offersBecause).toBe("another doctor");
    expect(appt.offers!.every((o) => o.doctorId === "doc-cardio-2")).toBe(true);
    expect(appt.chat!.at(-2)!.understood).toBe("another doctor");
  });

  it("…and picking a time afterwards goes to the AI as usual", async () => {
    await chatAction("appt-002", "vera doctor paakanum");
    await chatAction("appt-002", "A");
    expect(aiCalls).toBe(1);
  });
});

describe("everything else still goes to the AI", () => {
  it.each([
    ["appt-001", "Thursday after 4"],
    ["appt-001", "I'll wait"],
    // "no another doctor" isn't asking for one
    ["appt-002", "vera doctor venaam"],
    ["appt-003", "doosra doctor nahi chahiye"],
  ])("%s: %s → the AI answers", async (id, text) => {
    await chatAction(id, text);
    expect(aiCalls).toBe(1);
    expect((await getAppointment(id))!.chat!.at(-1)!.text).toBe(
      "Would you like to wait for a later time today, move to another day, or cancel?",
    );
  });
});

describe("the health check still runs first", () => {
  it("'vera doctor, nenju vali' → URGENT, and the AI isn't asked", async () => {
    await chatAction("appt-002", "vera doctor, nenju vali");
    expect(aiCalls).toBe(0);
    expect((await getAppointment("appt-002"))!.status).toBe("URGENT – staff call now");
  });
});
