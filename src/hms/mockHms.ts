// The FAKE hospital system (HMS).
//
// This is the ONLY file that reads or changes hospital data. The rest of the
// app calls the functions below and never touches the data files directly.
// To connect a real HMS later, write a new file with the same functions
// (same names, same return types) and switch the imports over to it.
//
// Where the data lives:
//   - mockData.json = the untouched starting data (never changed by the app).
//     It holds today and the next 7 days; each appointment has a "dayOffset"
//     (0 = today, 1 = tomorrow, …), so the demo always starts "today".
//   - Each visitor's CURRENT state (statuses, times, unavailabilities, pending
//     updates, simulated text messages) is rebuilt on every request from the
//     list of steps they took, kept in a cookie in their own browser
//     (see visitorState.ts). So every visitor gets their own demo, and
//     "Reset demo" just forgets their steps.
//
// The functions are "async" even though the fake data is instant,
// because a real HMS will be reached over the network.

import startingData from "./mockData.json";
import type {
  Appointment,
  Language,
  AppointmentWithPatient,
  CallLogEntry,
  CallResult,
  Doctor,
  Hospital,
  Patient,
  PendingUpdate,
  PendingUpdateWithDetails,
  SlotOffer,
  SmsMessage,
  Unavailability,
  UnavailabilityReason,
} from "./types";
import {
  clearSteps,
  isNearlyFull,
  readSteps,
  STAFF_REASONS,
  writeSteps,
  type AiAction,
  type DemoStep,
  type StaffReason,
} from "./visitorState";
import {
  anchorTime,
  DAY_START,
  DAYS_TO_SEARCH,
  findOtherDaySlots,
  emptySlotsToday,
  isOutsideClinicHours,
  wishEndsAt,
  wishStartsAt,
  pickOnDay,
  isClosedDay,
  listFreeSlots,
  originalTimeOf,
  pickClosestPerDay,
  pickOffers,
  NORMAL_DAY_END,
  planLaterToday,
  SLOT_MINUTES,
  type SlotQuery,
  type TimeOfDay,
  type TimeWish,
} from "@/lib/reschedulingRules";
import {
  anotherDayReply,
  callScript,
  dayLabelFor,
  laterTodayReply,
  OFFER_LETTERS,
  otherDayOffersScript,
} from "@/lib/callScript";
import {
  askTodayOrAnotherDay,
  cancelledReply,
  clinicHoursIntro,
  dayClosedPrefix,
  dayFullPrefix,
  doctorBackNothingBeforePrefix,
  doctorBackIntro,
  doctorBackNoneTodayPrefix,
  noFreeTodayPrefix,
  noMatchPrefix,
  slotTakenPrefix,
  staffWillCallReply,
  unclearReply,
  urgentReply,
} from "@/lib/chatReplies";
import { describeUnderstanding } from "@/lib/understanding/describe";
import { doctorNameFor } from "@/lib/names";
import type { Preferences, Understanding } from "@/lib/understanding/types";
import { timeChangedSms } from "@/lib/smsText";
import {
  formatDate,
  formatTime,
  formatTimeFor,
  formatWhen,
  fromMinutes,
  isValidTime,
  toMinutes,
} from "@/lib/time";

// Hospital, doctors and patients never change, so we read them straight
// from the starting data. (Tell TypeScript the JSON matches our types.)
const hospital = startingData.hospital as Hospital;
const doctors = startingData.doctors as Doctor[];
const patients = startingData.patients as Patient[];

// ---------- Each visitor's current state ----------

// Everything that CAN change.
interface HmsState {
  appointments: Appointment[];
  unavailabilities: Unavailability[];
  pendingUpdates: PendingUpdate[]; // texts waiting to be sent (one per appointment)
  messages: SmsMessage[]; // simulated text messages that were "sent" ("SMS outbox")
}

function startingState(): HmsState {
  return {
    // structuredClone makes a full copy, so the starting data stays untouched.
    appointments: structuredClone(startingData.appointments) as Appointment[],
    unavailabilities: [],
    pendingUpdates: [],
    messages: [],
  };
}

// Rebuild a demo: start from the starting data and redo every step in order.
function replay(steps: DemoStep[]): HmsState {
  const state = startingState();
  for (const step of steps) {
    switch (step.kind) {
      case "unavailable":
        applyUnavailable(state, step);
        break;
      case "call":
        applyCall(state, step);
        break;
      case "offer":
        applyOffer(state, step);
        break;
      case "send":
        applySend(state, step);
        break;
      case "chat":
        applyChat(state, step);
        break;
      case "falseAlarm":
        applyFalseAlarm(state, step);
        break;
      case "book":
        applyBook(state, step);
        break;
      case "ai":
        applyAi(state, step);
        break;
    }
  }
  return state;
}

// This visitor's current state.
async function loadState(): Promise<HmsState> {
  return replay(await readSteps());
}

// Does this appointment START inside the doctor's unavailable window?
// Unavailability is always about today (dayOffset 0).
// (from ≤ start < until — someone booked exactly at "until" is fine.)
function isInWindow(
  appt: Appointment,
  window: Pick<Unavailability, "doctorId" | "fromTime" | "untilTime">,
): boolean {
  return (
    appt.dayOffset === 0 &&
    appt.doctorId === window.doctorId &&
    appt.startTime >= window.fromTime &&
    appt.startTime < window.untilTime
  );
}

function withPatient(appt: Appointment): AppointmentWithPatient {
  return { ...appt, patient: patients.find((p) => p.id === appt.patientId)! };
}

// Earliest day first, then earliest time ("09:15" < "10:00" works as text).
function byDayAndTime(a: Appointment, b: Appointment): number {
  return a.dayOffset - b.dayOffset || a.startTime.localeCompare(b.startTime);
}

// ---------- Reading ----------

export async function getHospital(): Promise<Hospital> {
  return hospital;
}

export async function getDoctors(): Promise<Doctor[]> {
  return doctors;
}

export async function getDoctor(doctorId: string): Promise<Doctor | undefined> {
  return doctors.find((d) => d.id === doctorId);
}

// Is the hospital closed on this day? (0 = today, which is always open.)
export async function isClosed(dayOffset: number): Promise<boolean> {
  return isClosedDay(dayOffset);
}

// One doctor's appointments on one day, earliest first, with patient details.
// Empty on days the hospital is closed.
export async function getAppointmentsForDay(
  doctorId: string,
  dayOffset: number,
): Promise<AppointmentWithPatient[]> {
  if (isClosedDay(dayOffset)) return [];
  return (await loadState()).appointments
    .filter((a) => a.doctorId === doctorId && a.dayOffset === dayOffset)
    .sort(byDayAndTime)
    .map(withPatient);
}

// Appointments that were first booked on this day but have since moved to
// another day (so the front desk can still see where they went).
export async function getAppointmentsMovedAwayFrom(
  doctorId: string,
  dayOffset: number,
): Promise<AppointmentWithPatient[]> {
  return (await loadState()).appointments
    .filter(
      (a) =>
        a.doctorId === doctorId &&
        a.dayOffset !== dayOffset &&
        a.timeHistory?.[0]?.oldDayOffset === dayOffset,
    )
    .map(withPatient);
}

// Every doctor unavailability recorded today, in the order they were added.
export async function getUnavailabilities(): Promise<Unavailability[]> {
  return (await loadState()).unavailabilities;
}

export async function getUnavailability(id: string): Promise<Unavailability | undefined> {
  return (await loadState()).unavailabilities.find((u) => u.id === id);
}

// All appointments affected by one "doctor unavailable" event (whatever
// their status, day or time is now), earliest first, with patient details.
export async function getAffectedAppointments(
  unavailabilityId: string,
): Promise<AppointmentWithPatient[]> {
  return (await loadState()).appointments
    .filter((a) => a.unavailabilityId === unavailabilityId)
    .sort(byDayAndTime)
    .map(withPatient);
}

export async function getAppointment(id: string): Promise<AppointmentWithPatient | undefined> {
  const appt = (await loadState()).appointments.find((a) => a.id === id);
  return appt && withPatient(appt);
}

// Texts waiting to be sent, oldest change first, with appointment details.
export async function getPendingUpdates(): Promise<PendingUpdateWithDetails[]> {
  const state = await loadState();
  return state.pendingUpdates.map((u) => ({
    ...u,
    appointment: withPatient(state.appointments.find((a) => a.id === u.appointmentId)!),
  }));
}

// All simulated text messages that were "sent", newest first.
export async function getMessages(): Promise<SmsMessage[]> {
  return [...(await loadState()).messages].reverse();
}

// ---------- Changing ----------

// Is this visitor's demo history nearly too big for its cookie?
// (Then they should press "Reset demo".)
export async function isDemoNearlyFull(): Promise<boolean> {
  return isNearlyFull();
}

// Each change below has two parts:
//   - an exported function the app calls: it rebuilds the visitor's demo,
//     makes the change, and saves the new step in the visitor's cookie;
//   - an "apply…" function that makes the change to a state. The same apply
//     function is used again every time the demo is rebuilt from the steps,
//     so it must only use the step's own time (step.at), never "now".

// Record that a doctor is unavailable between two times today.
// Returns null if it couldn't be saved (the visitor's demo is full).
export async function markDoctorUnavailable(input: {
  doctorId: string;
  reason: UnavailabilityReason;
  fromTime: string;
  untilTime: string;
}): Promise<Unavailability | null> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "unavailable", at: Date.now(), ...input };
  const unavailability = applyUnavailable(replay(steps), step);
  return (await writeSteps([...steps, step])) ? unavailability : null;
}

// Every appointment that starts inside the window becomes
// "Affected – needs contact" and remembers which event affected it.
function applyUnavailable(
  state: HmsState,
  step: Extract<DemoStep, { kind: "unavailable" }>,
): Unavailability {
  const { doctorId, reason, fromTime, untilTime, at } = step;
  const input = { doctorId, reason, fromTime, untilTime };
  const id = `unavail-${at}`;

  let affectedCount = 0;
  for (const appt of state.appointments) {
    if (isInWindow(appt, input)) {
      appt.status = "Affected – needs contact";
      appt.unavailabilityId = id;
      affectedCount++;
    }
  }

  const unavailability: Unavailability = { id, ...input, affectedCount };
  state.unavailabilities.push(unavailability);
  return unavailability;
}

// Save what a patient answered on a call: add a line to the appointment's
// call log and change its status.
//   - "Later today" finds a new time today straight away; if there's no room,
//     the patient is offered other days instead.
//   - "Another day" offers other days.
// Only patients still waiting for a call (and not already looking at offers)
// can be recorded — this stops a double-click from logging the same call twice.
// Returns false if skipped (or the visitor's demo is full).
export async function recordCallResult(
  appointmentId: string,
  result: CallResult,
): Promise<boolean> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "call", at: Date.now(), appointmentId, result };
  if (!applyCall(replay(steps), step)) return false;
  return writeSteps([...steps, step]);
}

function applyCall(state: HmsState, step: Extract<DemoStep, { kind: "call" }>): boolean {
  const { appointmentId, result, at } = step;
  const appt = state.appointments.find((a) => a.id === appointmentId);
  if (!appt || appt.status !== "Affected – needs contact" || appt.offers) return false;

  const logEntry: CallLogEntry = { calledAt: new Date(at).toISOString(), result };
  appt.callLog = [...(appt.callLog ?? []), logEntry];

  if (result === "Wants later today") {
    const noRoomBecause = rescheduleLaterToday(state, appt, at);
    if (noRoomBecause) {
      logEntry.detail = `No room today: ${noRoomBecause}`;
      offerOtherDays(state, appt, "no room today");
    }
  } else if (result === "Wants another day") {
    offerOtherDays(state, appt, "asked");
  } else {
    appt.status = result;
  }
  return true;
}

// The patient picked one of the other-day offers (0 = A, 1 = B, …),
// or null for "None of these – call me".
// Returns "booked", "none", "taken" (that slot got booked meanwhile — fresh
// offers are made), or "skipped" (nothing to choose, e.g. a double-click).
export async function chooseOffer(
  appointmentId: string,
  choice: number | null,
): Promise<"booked" | "none" | "taken" | "skipped"> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "offer", at: Date.now(), appointmentId, choice };
  const outcome = applyOffer(replay(steps), step);
  if (outcome === "skipped") return outcome;
  return (await writeSteps([...steps, step])) ? outcome : "skipped";
}

function applyOffer(
  state: HmsState,
  step: Extract<DemoStep, { kind: "offer" }>,
): "booked" | "none" | "taken" | "skipped" {
  const { appointmentId, choice, at } = step;
  const appt = state.appointments.find((a) => a.id === appointmentId);
  if (!appt?.offers || appt.status !== "Affected – needs contact") return "skipped";

  const log = (detail: string) =>
    (appt.callLog = [
      ...(appt.callLog ?? []),
      { calledAt: new Date(at).toISOString(), result: "Wants another day", detail },
    ]);

  if (choice === null) {
    appt.status = "Needs staff call";
    appt.note = "Wants a different day";
    delete appt.offers;
    delete appt.offersBecause;
    log("None of these – call me");
    return "none";
  }

  const offer = appt.offers[choice];
  if (!offer) return "skipped";

  // Book it — bookSlotIn re-checks every rule (e.g. nobody took it meanwhile).
  if (!bookSlotIn(state, appt, offer, at).ok) {
    offerOtherDays(state, appt, appt.offersBecause ?? "asked");
    return "taken";
  }
  log(`Picked ${OFFER_LETTERS[choice]}: ${formatWhen(offer.dayOffset, offer.startTime)}`);
  return "booked";
}

// Give a patient who pressed "1 – Later today" a new time today, following the
// rules in lib/reschedulingRules.ts. Changes `state`; the caller saves it.
// Returns null if it worked, or the reason there was no room today.
function rescheduleLaterToday(state: HmsState, appt: Appointment, at: number): string | null {
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return "unknown unavailability"; // shouldn't happen
  const todaysAppointments = state.appointments.filter(
    (a) => a.doctorId === appt.doctorId && a.dayOffset === 0,
  );
  const plan = planLaterToday(appt, todaysAppointments, unavailability.untilTime);

  if (plan.kind === "no room") return plan.why;

  // The patient first, then (if there was a push) everyone who moves back.
  moveAppointment(
    state,
    appt,
    0,
    plan.newStartTime,
    "Patient chose a later time today",
    unavailability,
    at,
  );
  appt.status = "Rescheduled – later today";

  if (plan.kind === "push") {
    for (const p of plan.pushed) {
      const other = state.appointments.find((a) => a.id === p.appointmentId)!;
      moveAppointment(
        state,
        other,
        0,
        p.newStartTime,
        "Pushed back 15 minutes to make room for a rescheduled patient",
        unavailability,
        at,
      );
      // Only plain bookings become "Time moved". Someone already
      // "Rescheduled – later today" keeps that status (their new time still shows).
      if (other.status === "Scheduled") other.status = "Time moved";
    }
  }
  return null;
}

// Find other-day slots for the patient and keep them on the appointment
// until they pick one. If there are none at all in the coming days, the
// patient needs a staff call. Changes `state`; the caller saves it.
function offerOtherDays(
  state: HmsState,
  appt: Appointment,
  because: "asked" | "no room today",
): void {
  const doctorsAppointments = state.appointments.filter((a) => a.doctorId === appt.doctorId);
  const offers = findOtherDaySlots(appt, doctorsAppointments);

  if (offers.length === 0) {
    appt.status = "Needs staff call";
    appt.note =
      because === "no room today"
        ? "No room today or in the next days"
        : "No free slot in the next days";
    delete appt.offers;
    delete appt.offersBecause;
    return;
  }
  appt.offers = offers;
  appt.offersBecause = because;
}

// Change an appointment's day and time: note it in its history and keep ONE
// pending update for the patient with their latest time (nothing is sent yet —
// see sendPendingUpdates). Changes `state`; the caller saves it.
function moveAppointment(
  state: HmsState,
  appt: Appointment,
  newDayOffset: number,
  newStartTime: string,
  why: string,
  unavailability: Unavailability,
  at: number, // when it happened (the step's time)
): void {
  const now = new Date(at).toISOString();
  appt.timeHistory = [
    ...(appt.timeHistory ?? []),
    {
      changedAt: now,
      oldDayOffset: appt.dayOffset,
      oldStartTime: appt.startTime,
      newDayOffset,
      newStartTime,
      why,
    },
  ];
  appt.dayOffset = newDayOffset;
  appt.startTime = newStartTime;
  appt.endTime = fromMinutes(toMinutes(newStartTime) + SLOT_MINUTES);

  // Replace this patient's pending update (if any) with the latest day and time.
  state.pendingUpdates = state.pendingUpdates.filter((u) => u.appointmentId !== appt.id);
  state.pendingUpdates.push({
    appointmentId: appt.id,
    newDayOffset,
    newStartTime,
    reason: unavailability.reason,
    updatedAt: now,
  });
}

// "Send" every pending update: turn each into a text message in the outbox
// (in the patient's language) and clear the pending list. Nothing is really
// sent. If a patient is moved again later, they get a new pending update.
// Returns how many messages were "sent".
export async function sendPendingUpdates(): Promise<number> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "send", at: Date.now() };
  const sent = applySend(replay(steps), step);
  if (sent === 0) return 0;
  return (await writeSteps([...steps, step])) ? sent : 0;
}

function applySend(state: HmsState, step: Extract<DemoStep, { kind: "send" }>): number {
  const now = new Date(step.at).toISOString();

  for (const update of state.pendingUpdates) {
    const appt = state.appointments.find((a) => a.id === update.appointmentId)!;
    const patient = patients.find((p) => p.id === appt.patientId)!;
    const doctor = doctors.find((d) => d.id === appt.doctorId)!;
    state.messages.push({
      id: `sms-${state.messages.length + 1}`,
      sentAt: now,
      appointmentId: appt.id,
      toName: patient.name,
      toPhone: patient.phone,
      language: patient.preferredLanguage,
      text: timeChangedSms({
        language: patient.preferredLanguage,
        hospitalName: hospital.name,
        doctorName: doctorNameFor(doctor, patient.preferredLanguage),
        reason: update.reason,
        newDayOffset: update.newDayOffset,
        newStartTime: update.newStartTime,
      }),
    });
  }

  const sent = state.pendingUpdates.length;
  state.pendingUpdates = [];
  return sent;
}

// ---------- Tools: check_free_slots and book_slot ----------
// Used by the chat (rule-based today, AI later) and by the Buttons offers.
// Every time DocDelay mentions a slot, it came from checkFreeSlots.

export type BookResult = { ok: true } | { ok: false; reason: string };

// check_free_slots: real EMPTY slots for a doctor that match the query
// (days, time of day, after/before a time). Never a slot that would need
// anyone to move. Today's slots only from the doctor's return time on.
export async function checkFreeSlots(
  doctorId: string,
  query: SlotQuery,
  options: { excludeAppointmentId?: string; todayFrom?: string } = {},
): Promise<SlotOffer[]> {
  const state = await loadState();
  return listFreeSlots(
    state.appointments.filter((a) => a.doctorId === doctorId),
    query,
    options,
  );
}

// book_slot: re-check a slot under ALL the rules, then book it or refuse
// with a reason. It only ever books an EMPTY slot — nobody is ever pushed to
// fit a chosen slot (pushing only happens for a plain "later today" answer
// with no time, through its own rules). If the patient asked for a time
// (`wish`, e.g. "after 4"), the slot must also be within it.
export async function bookSlot(
  appointmentId: string,
  slot: SlotOffer,
  wish?: TimeWish,
): Promise<BookResult> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "book", at: Date.now(), appointmentId, ...slot };
  // (The wish only narrows what may be booked, so replaying the saved step
  // later without it gives the same result.)
  const result = applyBook(replay(steps), step, wish);
  if (!result.ok) return result;
  return (await writeSteps([...steps, step]))
    ? result
    : { ok: false, reason: "This demo has too much history. Press “Reset demo”." };
}

function applyBook(
  state: HmsState,
  step: Extract<DemoStep, { kind: "book" }>,
  wish?: TimeWish,
): BookResult {
  const appt = state.appointments.find((a) => a.id === step.appointmentId);
  if (!appt) return { ok: false, reason: "Unknown appointment." };
  const slot = { dayOffset: step.dayOffset, startTime: step.startTime };
  const result = bookSlotIn(state, appt, slot, step.at, wish);
  if (result.ok) {
    appt.callLog = [
      ...(appt.callLog ?? []),
      {
        calledAt: new Date(step.at).toISOString(),
        detail: `Booked ${formatWhen(slot.dayOffset, slot.startTime)}`,
      },
    ];
  }
  return result;
}

// The rules for booking one slot (changes `state`; the caller saves it):
//   - the patient must still be waiting for a new time;
//   - the slot must be one checkFreeSlots would list right now: EMPTY, on an
//     open day, within opening hours, and — today — from the doctor's return
//     time on. So nobody else is ever moved, and if two patients pick the
//     same slot, the first one wins and the second is refused;
//   - if the patient asked for a time (`wish`), the slot must be within it;
//   - a chosen slot must END by NORMAL_DAY_END (5:00 PM). Slots after that are
//     only ever created by the "later today" push, never booked here.
function bookSlotIn(
  state: HmsState,
  appt: Appointment,
  slot: SlotOffer,
  at: number,
  wish?: TimeWish,
): BookResult {
  if (appt.status !== "Affected – needs contact") {
    return { ok: false, reason: "This patient isn't waiting for a new time." };
  }
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return { ok: false, reason: "Unknown doctor unavailability." };

  const free = listFreeSlots(
    state.appointments.filter((a) => a.doctorId === appt.doctorId),
    { days: [slot.dayOffset], ...wish },
    { excludeAppointmentId: appt.id, todayFrom: unavailability.untilTime },
  );
  if (!free.some((f) => f.startTime === slot.startTime)) {
    return { ok: false, reason: "That slot isn't free any more (or it's outside the rules)." };
  }

  const today = slot.dayOffset === 0;
  if (toMinutes(slot.startTime) + SLOT_MINUTES > toMinutes(NORMAL_DAY_END)) {
    return { ok: false, reason: "Chosen times must be within normal hours (until 5:00 PM)." };
  }
  moveAppointment(
    state,
    appt,
    slot.dayOffset,
    slot.startTime,
    today ? "Patient chose a later time today" : "Patient chose another day",
    unavailability,
    at,
  );
  appt.status = today ? "Rescheduled – later today" : "Rescheduled – another day";
  delete appt.offers;
  delete appt.offersBecause;
  return { ok: true };
}

// ---------- Chat mode ----------

// A patient's chat message, together with what it was understood to mean
// (the understanding is done BEFORE this, in lib/understanding). Runs the
// conversation one step and saves it. Returns false if nothing happened.
export async function sendChatMessage(
  appointmentId: string,
  text: string,
  understanding: Understanding,
): Promise<boolean> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "chat", at: Date.now(), appointmentId, text, understanding };
  if (!applyChat(replay(steps), step)) return false;
  return writeSteps([...steps, step]);
}

// Other-day offers for a chat request:
//   - a NAMED day ("Monday afternoon"): up to 3 slots on that day matching
//     the time ("matched"); if it has none → "day full" (or "day closed") and
//     the NEAREST other days, one per day;
//   - otherwise one per day, earliest days first: "matched" if slots match
//     the time, else "no match" with the closest free slots;
//   - "outside hours": the time is outside clinic hours (e.g. "after 6") →
//     the closest free slots, one per day, from the named day (if any) on.
// An empty list means the doctor has no free slot at all in the coming days.
function chatOffers(
  state: HmsState,
  appt: Appointment,
  wish: Preferences,
): {
  note: "matched" | "day full" | "day closed" | "outside hours" | "no match";
  offers: SlotOffer[];
} {
  const doctorsAppointments = state.appointments.filter((a) => a.doctorId === appt.doctorId);
  const free = (query: SlotQuery) =>
    listFreeSlots(doctorsAppointments, query, { excludeAppointmentId: appt.id });
  const allDays = Array.from({ length: DAYS_TO_SEARCH }, (_, i) => i + 1); // 1 … DAYS_TO_SEARCH
  const day = wish.dayOffset;
  const named = day !== undefined && day > 0 && day <= DAYS_TO_SEARCH ? day : undefined;
  const anchor = anchorTime(wish, originalTimeOf(appt));
  const time = { timeOfDay: wish.timeOfDay, after: wish.after, before: wish.before };

  if (isOutsideClinicHours(time)) {
    const fromDay = allDays.filter((d) => d >= (named ?? 1));
    return { note: "outside hours", offers: pickClosestPerDay(free({ days: fromDay }), anchor) };
  }

  if (named !== undefined) {
    // The named day first: up to 3 slots on it.
    const onDay = isClosedDay(named) ? [] : free({ days: [named], ...time });
    if (onDay.length > 0) return { note: "matched", offers: pickOnDay(onDay, anchor) };
    // Nothing there: the nearest other days, one per day (at the asked time if possible).
    const otherDays = allDays.filter((d) => d !== named);
    const matching = free({ days: otherDays, ...time });
    const pool = matching.length > 0 ? matching : free({ days: otherDays });
    return {
      note: isClosedDay(named) ? "day closed" : "day full",
      offers: pickClosestPerDay(pool, anchor, undefined, named),
    };
  }

  const matching = free({ days: allDays, ...time });
  if (matching.length > 0 && day === undefined) {
    return { note: "matched", offers: pickOffers(matching, anchor) };
  }
  return { note: "no match", offers: pickClosestPerDay(free({ days: allDays }), anchor) };
}

// ---------- Which slots to offer for a wish (shared by the rule-based chat and the AI) ----------

// What happened when looking for slots — decides the wording of the reply.
export type OfferSituation =
  // today (the patient asked for a time TODAY):
  | "today" // empty slots today at the asked time
  | "today, doctor back" // the asked time starts before the doctor is back → slots from the return
  | "nothing before, doctor back" // "before 11", doctor back at 11 → nothing today; other days before 11
  | "none today, doctor back" // asked time starts before the return, nothing free after it
  | "none today" // nothing empty today at the asked time → other days at that time
  // other days (or any day):
  | "matched" // slots match the wish
  | "day full" // the named day has nothing at that time → nearest other days
  | "day closed" // the named day is a closed day → nearest other days
  | "outside hours" // the asked time is outside clinic hours → closest slots, one per day
  | "no match"; // nothing matches → closest slots, one per day

export interface OfferResult {
  situation: OfferSituation;
  offers: SlotOffer[]; // empty = the doctor has no free slot at all in the coming days
  dayOffset?: number; // the day the patient named (for "day full" / "day closed")
  backAt?: string; // the doctor's return time (for the "doctor back" situations)
  endsAt?: string; // the end of the asked time (for "nothing before, doctor back")
}

// The slots to offer for a patient's wish, following ALL the rules in
// reschedulingRules.ts. `today` = the patient asked for a time today.
// Never changes anything (read-only).
function findOffers(
  state: HmsState,
  appt: Appointment,
  wish: Preferences,
  today: boolean,
  days?: number[], // several days to choose from (e.g. "next week, not Monday")
): OfferResult {
  if (!today && days) {
    // One per day across the given days, matching the time if possible.
    const doctorsAppointments = state.appointments.filter((a) => a.doctorId === appt.doctorId);
    const free = (query: SlotQuery) =>
      listFreeSlots(doctorsAppointments, query, { excludeAppointmentId: appt.id });
    const time: TimeWish = { timeOfDay: wish.timeOfDay, after: wish.after, before: wish.before };
    const anchor = anchorTime(time, originalTimeOf(appt));
    if (isOutsideClinicHours(time)) {
      return { situation: "outside hours", offers: pickClosestPerDay(free({ days }), anchor) };
    }
    const matching = free({ days, ...time });
    return matching.length > 0
      ? { situation: "matched", offers: pickOffers(matching, anchor) }
      : { situation: "no match", offers: pickClosestPerDay(free({ days }), anchor) };
  }
  if (!today) {
    const { note, offers } = chatOffers(state, appt, wish);
    return { situation: note, offers, dayOffset: wish.dayOffset };
  }
  const time: TimeWish = { timeOfDay: wish.timeOfDay, after: wish.after, before: wish.before };
  const back = state.unavailabilities.find((u) => u.id === appt.unavailabilityId)!.untilTime;
  const doctorsAppointments = state.appointments.filter((a) => a.doctorId === appt.doctorId);

  // Outside clinic hours ("after 6", "before 8"): the closest slots,
  // one per day, earliest days first (today included).
  if (isOutsideClinicHours(time)) {
    const everyDay = Array.from({ length: DAYS_TO_SEARCH + 1 }, (_, d) => d);
    const free = listFreeSlots(
      doctorsAppointments,
      { days: everyDay },
      { excludeAppointmentId: appt.id, todayFrom: back },
    );
    return {
      situation: "outside hours",
      offers: pickClosestPerDay(free, anchorTime(time, originalTimeOf(appt))),
    };
  }

  // Slots always respect the WHOLE asked time — its start is covered anyway
  // (slots start at the doctor's return), and its end is never passed:
  // "before 11" never offers 11:00 or later.
  const beforeReturn = toMinutes(wishStartsAt(time)) < toMinutes(back);
  const todaySlots = emptySlotsToday(doctorsAppointments, back, time, appt.id);
  if (todaySlots.length > 0) {
    return {
      situation: beforeReturn ? "today, doctor back" : "today",
      offers: todaySlots,
      backAt: back,
    };
  }

  // Nothing empty today: other days at the asked time.
  const { offers } = chatOffers(state, appt, time);
  const endsAt = wishEndsAt(time);
  if (endsAt && toMinutes(back) >= toMinutes(endsAt)) {
    return { situation: "nothing before, doctor back", offers, backAt: back, endsAt };
  }
  return {
    situation: beforeReturn ? "none today, doctor back" : "none today",
    offers,
    backAt: back,
  };
}

// The rule-based chat's reply for an OfferResult, in the patient's language.
function offerText(language: Language, found: OfferResult, doctorName: string): string {
  const { situation, offers, dayOffset, backAt, endsAt } = found;
  const script = (intro?: string) => otherDayOffersScript(language, offers, false, intro);
  switch (situation) {
    case "today":
    case "matched":
      return script();
    case "today, doctor back":
      return script(doctorBackIntro(language, doctorName, backAt!));
    case "outside hours":
      return script(clinicHoursIntro(language));
    case "nothing before, doctor back":
      return `${doctorBackNothingBeforePrefix(language, doctorName, backAt!, endsAt!)} ${script()}`;
    case "none today, doctor back":
      return `${doctorBackNoneTodayPrefix(language, doctorName, backAt!)} ${script()}`;
    case "none today":
      return `${noFreeTodayPrefix(language)} ${script()}`;
    case "day full":
      return `${dayFullPrefix(language, dayOffset!)} ${script()}`;
    case "day closed":
      return `${dayClosedPrefix(language, dayOffset!)} ${script()}`;
    case "no match":
      return `${noMatchPrefix(language)} ${script()}`;
  }
}

// One chat turn. Replies use the existing wording in the patient's language
// and only ever mention slots from checkFreeSlots. Changes `state`.
function applyChat(state: HmsState, step: Extract<DemoStep, { kind: "chat" }>): boolean {
  const appt = state.appointments.find((a) => a.id === step.appointmentId);
  if (!appt || appt.status !== "Affected – needs contact") return false;
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return false;

  const patient = patients.find((p) => p.id === appt.patientId)!;
  const doctor = doctors.find((d) => d.id === appt.doctorId)!;
  const language = patient.preferredLanguage;
  const doctorName = doctorNameFor(doctor, language); // e.g. "டாக்டர் மீரா கிருஷ்ணன் (Dr. Meera Krishnan)"
  const when = new Date(step.at).toISOString();
  const u = step.understanding;
  const say = (text: string) => appt.chat!.push({ at: when, from: "docdelay", text });
  const log = (result: CallResult | undefined, detail: string) =>
    (appt.callLog = [
      ...(appt.callLog ?? []),
      { calledAt: when, result, detail: `Chat: ${detail}` },
    ]);
  const dropOffers = () => {
    delete appt.offers;
    delete appt.offersBecause;
  };

  // The chat starts with what DocDelay said first.
  if (!appt.chat?.length) {
    appt.chat = [];
    say(openingLine(appt, unavailability));
  }
  appt.chat.push({
    at: when,
    from: "patient",
    text: step.text,
    understood: describeUnderstanding(u),
  });

  // Couldn't understand: ask again once; the second time in a row, hand over to staff.
  const unclear = () => {
    appt.unclearInARow = (appt.unclearInARow ?? 0) + 1;
    if (appt.unclearInARow >= 2) {
      appt.status = "Needs staff call";
      appt.note = "Couldn't understand";
      dropOffers();
      say(staffWillCallReply(language));
      log("Needs staff call", "couldn't understand 2 replies in a row");
    } else {
      say(unclearReply(language, Boolean(appt.offers)));
    }
    return true;
  };
  if (u.intent !== "unclear") appt.unclearInARow = 0;

  // A time given earlier without a day ("after 4") is used with the answer to
  // "today, or another day?" — unless the new message names a time itself.
  const timeOf = (p: Preferences): TimeWish | undefined =>
    p.timeOfDay || p.after || p.before
      ? { timeOfDay: p.timeOfDay, after: p.after, before: p.before }
      : undefined;
  const prefs: Preferences = timeOf(u.preferences)
    ? u.preferences
    : { ...u.preferences, ...appt.timeWish };
  if (u.intent !== "unclear" && u.intent !== "time_without_day") delete appt.timeWish;

  switch (u.intent) {
    // SAFETY: any health concern stops rescheduling at once. Nothing is
    // booked, reserved or prioritised; any later rebooking follows the normal rules.
    case "health_concern":
      appt.status = "URGENT – staff call now";
      dropOffers();
      say(urgentReply(language));
      log(undefined, "health concern mentioned → URGENT staff call");
      return true;

    case "talk_to_person":
      appt.status = "Needs staff call";
      appt.note = appt.offers ? "Wants a different day" : "Asked to talk to a person";
      dropOffers();
      say(staffWillCallReply(language));
      log("Needs staff call", appt.note);
      return true;

    case "cancel":
      appt.status = "Cancelled";
      dropOffers();
      say(cancelledReply(language));
      log("Cancelled", "cancelled");
      return true;

    // A time but no day — don't guess: ask. (Not an "unclear" reply.)
    case "time_without_day":
      appt.timeWish = timeOf(u.preferences);
      say(askTodayOrAnotherDay(language));
      return true;

    case "later_today": {
      const todayWish = timeOf(prefs); // e.g. "after 4" → only at or after 4 PM

      // A SPECIFIC time today: offer up to 3 EMPTY slots (A/B/C) and let the
      // patient pick — nobody is ever pushed to fit a chosen time (see
      // reschedulingRules.ts). Picking one books it through bookSlotIn.
      if (todayWish) {
        const found = findOffers(state, appt, todayWish, true);
        if (found.offers.length === 0) {
          appt.status = "Needs staff call";
          appt.note = "No free slot in the next days";
          dropOffers();
          say(staffWillCallReply(language));
          return true;
        }
        appt.offers = found.offers;
        appt.offersBecause = "asked";
        say(offerText(language, found, doctorName));
        log("Wants later today", found.situation);
        return true;
      }

      // A plain "later today" / "I'll wait" with no time: the existing rules
      // (empty slot first, then the push with the 45-minute cap and 7 PM limit).
      if (appt.offers && appt.offersBecause === "no room today") {
        // Today is still full — repeat the other-day offers.
        say(otherDayOffersScript(language, appt.offers, true));
        return true;
      }
      const noRoomBecause = rescheduleLaterToday(state, appt, step.at);
      if (!noRoomBecause) {
        dropOffers();
        say(laterTodayReply(language, appt.startTime));
        log("Wants later today", `new time ${formatTime(appt.startTime)} today`);
        return true;
      }
      log("Wants later today", `No room today: ${noRoomBecause}`);
      offerOtherDays(state, appt, "no room today");
      say(
        appt.offers
          ? otherDayOffersScript(language, appt.offers, true)
          : staffWillCallReply(language),
      );
      return true;
    }

    case "another_day": {
      const found = findOffers(state, appt, prefs, false);
      if (found.offers.length === 0) {
        appt.status = "Needs staff call";
        appt.note = "No free slot in the next days";
        dropOffers();
        say(staffWillCallReply(language));
        log("Wants another day", "no free slot in the next days");
        return true;
      }
      appt.offers = found.offers;
      appt.offersBecause = "asked";
      say(offerText(language, found, doctorName));
      return true;
    }

    case "choose_offer": {
      const offer = u.offerIndex !== undefined ? appt.offers?.[u.offerIndex] : undefined;
      if (!offer) return unclear();
      if (bookSlotIn(state, appt, offer, step.at).ok) {
        say(
          offer.dayOffset === 0
            ? laterTodayReply(language, offer.startTime)
            : anotherDayReply(language, offer.dayOffset, offer.startTime),
        );
        log(
          "Wants another day",
          `picked ${OFFER_LETTERS[u.offerIndex!]}: ${formatWhen(offer.dayOffset, offer.startTime)}`,
        );
        return true;
      }
      // Taken meanwhile — first one wins; this patient gets fresh options.
      offerOtherDays(state, appt, appt.offersBecause ?? "asked");
      say(
        `${slotTakenPrefix(language)} ${
          appt.offers
            ? otherDayOffersScript(language, appt.offers, false)
            : staffWillCallReply(language)
        }`,
      );
      return true;
    }

    default:
      return unclear();
  }
}

// What DocDelay said first in a chat: the call script — or, if the patient was
// already looking at offers (e.g. from Buttons mode), those offers.
function openingLine(appt: Appointment, unavailability: Unavailability): string {
  const patient = patients.find((p) => p.id === appt.patientId)!;
  const doctor = doctors.find((d) => d.id === appt.doctorId)!;
  const language = patient.preferredLanguage;
  return appt.offers
    ? otherDayOffersScript(language, appt.offers, appt.offersBecause === "no room today")
    : callScript({
        language,
        patientName: patient.name,
        hospitalName: hospital.name,
        doctorName: doctorNameFor(doctor, language),
        reason: unavailability.reason,
        appointmentTime: appt.startTime,
        untilTime: unavailability.untilTime,
      });
}

// ---------- AI chat (Claude) ----------
// The AI only TALKS; the hms module DECIDES. Each AI turn gets a private copy
// of the visitor's demo. The AI's tools read slots (the same offer rules as the
// rule-based chat — findOffers) and TRY outcomes on that copy, with the same
// booking rules as everywhere else (bookSlotIn, the push rules for a plain
// "later today"). Nothing is saved until the turn is finished and its reply
// has been checked (lib/understanding/aiChat.ts); then it's saved as ONE
// "ai" step, which replaying applies again with the same rules.

// The tools the AI can use (their descriptions for the AI are in lib/understanding/claude.ts).
export const AI_TOOL_NAMES = [
  "check_free_slots",
  "book_slot",
  "wait_later_today",
  "cancel_appointment",
  "hand_to_staff",
  "escalate_urgent",
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];

// A slot as shown to the AI: `say` is exactly how to write it to the patient.
export interface AiSlot {
  option: string; // "A", "B", "C"
  day_offset: number;
  start_time: string; // "HH:MM"
  say: string; // e.g. "Mon 28 Sep, 4:00 PM" or "செப்டம்பர் 28, திங்கள், மாலை 4:00 (4:00 PM)"
}

// EVERYTHING the AI is told about the patient and the situation. Only the
// patient's FIRST name — never their full name or phone number.
export interface AiTurnContext {
  firstName: string;
  language: Language;
  reason: UnavailabilityReason;
  originalTimeSay: string; // their original appointment time, in their language
  doctorNameSay: string; // e.g. "डॉ. मीरा कृष्णन (Dr. Meera Krishnan)"
  doctorBackSay: string; // when the doctor is expected back
  calendar: { day_offset: number; date: string; closed: boolean }[]; // today … +7 days
  currentOffers: AiSlot[]; // offers the patient is already looking at
  history: { from: "patient" | "docdelay"; text: string }[]; // earlier chat (without the opening)
}

export interface AiTurn {
  context: AiTurnContext;
  runTool(name: AiToolName, input: Record<string, unknown>): Record<string, unknown>;
  allowedTimes(): Set<string>; // "HH:MM" times the reply may mention
  outcome(): AiAction | undefined;
  save(text: string, reply: string): Promise<boolean>;
}

const STAFF_NOTES: Record<StaffReason, string> = {
  asked_for_person: "Asked to talk to a person",
  could_not_understand: "Couldn't understand",
  no_suitable_time: "No suitable time",
};

// English explanation of what check_free_slots found, for the AI.
function explainForAi(found: OfferResult): string {
  const back = found.backAt ? formatTime(found.backAt) : "";
  const end = found.endsAt ? formatTime(found.endsAt) : "";
  const day =
    found.dayOffset !== undefined && found.dayOffset > 0 ? formatDate(found.dayOffset) : "";
  if (found.offers.length === 0) {
    return "No free slots at all in the coming days. Call hand_to_staff with reason no_suitable_time.";
  }
  return {
    today: "Empty slots today at the asked time.",
    "today, doctor back": `The doctor is back at ${back}, so these are the earliest empty slots today. Say that first.`,
    "nothing before, doctor back": `The doctor is back at ${back}, so nothing is free before ${end} today. Say that, then offer these other days (before ${end}).`,
    "none today, doctor back": `The doctor is back at ${back}, but nothing is free today after that. Say that, then offer these other days.`,
    "none today":
      "Nothing is free today at that time. Say that, then offer these other days at that time.",
    matched: "These slots match the request.",
    "day full": `${day} is full at that time. Say that, then offer these nearest other days.`,
    "day closed": `The clinic is closed on ${day}. Say that, then offer these nearest other days.`,
    "outside hours": `That time is outside clinic hours (${formatTime(DAY_START)} to ${formatTime(NORMAL_DAY_END)}). Say that, then offer these closest slots.`,
    "no match": "Nothing matches exactly. Say that, then offer these closest slots.",
  }[found.situation];
}

// Start an AI turn for a patient who is waiting for a new time.
// Returns undefined if the patient isn't in a call any more.
export async function startAiTurn(appointmentId: string): Promise<AiTurn | undefined> {
  const steps = await readSteps();
  const state = replay(steps);
  const appt = state.appointments.find((a) => a.id === appointmentId);
  if (!appt || appt.status !== "Affected – needs contact") return undefined;
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return undefined;

  const patient = patients.find((p) => p.id === appt.patientId)!;
  const doctor = doctors.find((d) => d.id === appt.doctorId)!;
  const language = patient.preferredLanguage;
  const at = Date.now(); // this turn's time — used again when it's replayed
  const say = (o: SlotOffer) =>
    `${dayLabelFor(o.dayOffset, language)}, ${formatTimeFor(o.startTime, language)}`;
  const toAiSlots = (offers: SlotOffer[]): AiSlot[] =>
    offers.map((o, i) => ({
      option: OFFER_LETTERS[i],
      day_offset: o.dayOffset,
      start_time: o.startTime,
      say: say(o),
    }));

  const offered: SlotOffer[] = []; // slots offered in this turn
  let outcome: AiAction | undefined; // at most one per turn
  const times = new Set<string>([
    originalTimeOf(appt),
    unavailability.untilTime,
    DAY_START,
    NORMAL_DAY_END,
    ...(appt.offers ?? []).map((o) => o.startTime),
  ]);
  // Try something on a throw-away copy, so a failed attempt changes nothing.
  const onCopy = <T>(fn: (copyState: HmsState, copyAppt: Appointment) => T): T => {
    const copyState = structuredClone(state);
    return fn(
      copyState,
      copyState.appointments.find((a) => a.id === appt.id)!,
    );
  };
  const alreadyDone = { ok: false, reason: "An outcome was already recorded in this turn." };
  const timeOrUndefined = (v: unknown) => (typeof v === "string" && isValidTime(v) ? v : undefined);

  const tools: Record<AiToolName, (input: Record<string, unknown>) => Record<string, unknown>> = {
    check_free_slots(input) {
      const days = Array.isArray(input.days)
        ? input.days.filter(
            (d): d is number => Number.isInteger(d) && d >= 1 && d <= DAYS_TO_SEARCH,
          )
        : [];
      const timeOfDay = ["morning", "afternoon", "evening"].includes(String(input.time_of_day))
        ? (input.time_of_day as TimeOfDay)
        : undefined;
      const wish: Preferences = {
        timeOfDay,
        after: timeOrUndefined(input.after),
        before: timeOrUndefined(input.before),
      };
      const found =
        input.when === "today"
          ? findOffers(state, appt, wish, true)
          : findOffers(
              state,
              appt,
              { ...wish, dayOffset: days.length === 1 ? days[0] : undefined },
              false,
              days.length > 1 ? days : undefined,
            );
      // Keep every slot offered in this turn (the AI may check more than once),
      // up to 5 — the most that can be labelled A–E.
      for (const o of found.offers) {
        const seen = offered.some(
          (x) => x.dayOffset === o.dayOffset && x.startTime === o.startTime,
        );
        if (!seen && offered.length < OFFER_LETTERS.length) offered.push(o);
        times.add(o.startTime);
      }
      if (found.backAt) times.add(found.backAt);
      if (found.endsAt) times.add(found.endsAt);
      return {
        situation: found.situation,
        explanation: explainForAi(found),
        slots: toAiSlots(offered),
      };
    },
    book_slot(input) {
      if (outcome) return alreadyDone;
      const slot = { dayOffset: Number(input.day_offset), startTime: String(input.start_time) };
      if (!Number.isInteger(slot.dayOffset) || !isValidTime(slot.startTime)) {
        return { ok: false, reason: "Invalid slot." };
      }
      const result = onCopy((copyState, copyAppt) => bookSlotIn(copyState, copyAppt, slot, at));
      if (!result.ok) {
        return { ...result, hint: "Call check_free_slots again and only offer what it returns." };
      }
      outcome = { kind: "book", ...slot };
      times.add(slot.startTime);
      return { ok: true, booked: say(slot), today: slot.dayOffset === 0 };
    },
    wait_later_today() {
      if (outcome) return alreadyDone;
      const result = onCopy((copyState, copyAppt) => {
        const noRoom = rescheduleLaterToday(copyState, copyAppt, at);
        return noRoom ? { noRoom } : { newTime: copyAppt.startTime };
      });
      if ("noRoom" in result) {
        return {
          ok: false,
          reason: `No room today: ${result.noRoom}.`,
          hint: "Say there is no room today, then offer other days with check_free_slots (when: other_days).",
        };
      }
      outcome = { kind: "wait" };
      times.add(result.newTime);
      return { ok: true, new_time: say({ dayOffset: 0, startTime: result.newTime }) };
    },
    cancel_appointment() {
      if (outcome) return alreadyDone;
      outcome = { kind: "cancel" };
      return { ok: true };
    },
    hand_to_staff(input) {
      if (outcome) return alreadyDone;
      const reason = STAFF_REASONS.includes(input.reason as StaffReason)
        ? (input.reason as StaffReason)
        : "asked_for_person";
      outcome = { kind: "staff", reason };
      return { ok: true, tell_patient: staffWillCallReply(language) };
    },
    escalate_urgent() {
      // Allowed even after another outcome would have been — safety first.
      outcome = { kind: "urgent" };
      return { ok: true, say_exactly: urgentReply(language) };
    },
  };

  return {
    context: {
      firstName: patient.name.split(" ")[0],
      language,
      reason: unavailability.reason,
      originalTimeSay: formatTimeFor(originalTimeOf(appt), language),
      doctorNameSay: doctorNameFor(doctor, language),
      doctorBackSay: formatTimeFor(unavailability.untilTime, language),
      calendar: Array.from({ length: DAYS_TO_SEARCH + 1 }, (_, d) => ({
        day_offset: d,
        date: d === 0 ? `today (${formatDate(0)})` : formatDate(d),
        closed: isClosedDay(d),
      })),
      currentOffers: toAiSlots(appt.offers ?? []),
      history: (appt.chat ?? []).slice(1).map((t) => ({ from: t.from, text: t.text })),
    },
    runTool: (name, input) => tools[name](input),
    allowedTimes: () => times,
    outcome: () => outcome,
    // For a turn with an outcome, the reply is DocDelay's fixed confirmation
    // (added when the step is applied), so `reply` is ignored and not stored.
    async save(text, reply) {
      const step: DemoStep = {
        kind: "ai",
        at,
        appointmentId,
        text,
        reply: outcome ? "" : reply,
        offers: outcome ? [] : offered,
        action: outcome,
      };
      if (!applyAi(replay(steps), step)) return false; // must apply cleanly
      return writeSteps([...steps, step]);
    },
  };
}

// Apply a saved AI turn (also when the demo is rebuilt). Same rules as
// everywhere else; returns false if it doesn't apply.
function applyAi(state: HmsState, step: Extract<DemoStep, { kind: "ai" }>): boolean {
  const appt = state.appointments.find((a) => a.id === step.appointmentId);
  if (!appt || appt.status !== "Affected – needs contact") return false;
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return false;
  const language = patients.find((p) => p.id === appt.patientId)!.preferredLanguage;
  const when = new Date(step.at).toISOString();
  const action = step.action;
  const log = (result: CallResult | undefined, detail: string) =>
    (appt.callLog = [
      ...(appt.callLog ?? []),
      { calledAt: when, result, detail: `AI chat: ${detail}` },
    ]);
  const dropOffers = () => {
    delete appt.offers;
    delete appt.offersBecause;
  };

  if (!appt.chat?.length)
    appt.chat = [{ at: when, from: "docdelay", text: openingLine(appt, unavailability) }];
  const understood = !action
    ? step.offers.length
      ? `AI · offered ${step.offers.map((o) => formatWhen(o.dayOffset, o.startTime)).join(" / ")}`
      : "AI · replied"
    : action.kind === "book"
      ? `AI · booked ${formatWhen(action.dayOffset, action.startTime)}`
      : action.kind === "staff"
        ? `AI · staff call (${action.reason.replace(/_/g, " ")})`
        : `AI · ${{ wait: "waits for later today", cancel: "cancelled", urgent: "URGENT (health concern)" }[action.kind]}`;
  appt.chat.push({ at: when, from: "patient", text: step.text, understood });
  appt.unclearInARow = 0;
  delete appt.timeWish;

  if (!action) {
    if (step.offers.length) {
      appt.offers = step.offers;
      appt.offersBecause = "asked";
    }
  } else if (action.kind === "book") {
    const slot = { dayOffset: action.dayOffset, startTime: action.startTime };
    if (!bookSlotIn(state, appt, slot, step.at).ok) return false;
    log(
      slot.dayOffset === 0 ? "Wants later today" : "Wants another day",
      `booked ${formatWhen(slot.dayOffset, slot.startTime)}`,
    );
  } else if (action.kind === "wait") {
    if (rescheduleLaterToday(state, appt, step.at)) return false;
    dropOffers();
    log("Wants later today", `new time ${formatTime(appt.startTime)} today`);
  } else if (action.kind === "cancel") {
    appt.status = "Cancelled";
    dropOffers();
    log("Cancelled", "cancelled");
  } else if (action.kind === "staff") {
    appt.status = "Needs staff call";
    appt.note = STAFF_NOTES[action.reason];
    dropOffers();
    log("Needs staff call", appt.note);
  } else {
    // SAFETY: the same as the rule-based check — nothing booked or reserved.
    appt.status = "URGENT – staff call now";
    dropOffers();
    log(undefined, "health concern → URGENT staff call");
  }
  // Outcomes are confirmed with DocDelay's FIXED wording (the same lines as
  // the rule-based chat — always with AM/PM and the local time words), never
  // with AI-written text. The urgent reply is always the fixed safety line.
  const confirmation = !action
    ? step.reply
    : action.kind === "urgent"
      ? urgentReply(language)
      : action.kind === "cancel"
        ? cancelledReply(language)
        : action.kind === "staff"
          ? staffWillCallReply(language)
          : appt.dayOffset === 0
            ? laterTodayReply(language, appt.startTime)
            : anotherDayReply(language, appt.dayOffset, appt.startTime);
  appt.chat.push({ at: when, from: "docdelay", text: confirmation });
  return true;
}

// ---------- URGENT flags ----------

// A staff member says an URGENT flag was a false alarm: the patient goes back
// to "Affected – needs contact" (and back into the normal call queue — no
// advantage, no penalty). It's logged with who and when.
export async function markFalseAlarm(appointmentId: string): Promise<boolean> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "falseAlarm", at: Date.now(), appointmentId };
  if (!applyFalseAlarm(replay(steps), step)) return false;
  return writeSteps([...steps, step]);
}

// The demo has no staff logins, so every false alarm is marked by "Front desk".
const STAFF_NAME = "Front desk";

function applyFalseAlarm(
  state: HmsState,
  step: Extract<DemoStep, { kind: "falseAlarm" }>,
): boolean {
  const appt = state.appointments.find((a) => a.id === step.appointmentId);
  if (!appt || appt.status !== "URGENT – staff call now") return false;
  const when = new Date(step.at).toISOString();
  appt.status = "Affected – needs contact";
  appt.unclearInARow = 0;
  appt.falseAlarms = [...(appt.falseAlarms ?? []), { at: when, by: STAFF_NAME }];
  appt.callLog = [
    ...(appt.callLog ?? []),
    {
      calledAt: when,
      detail: `Marked as a false alarm by ${STAFF_NAME} — back to "Affected – needs contact"`,
    },
  ];
  return true;
}

// Everyone who needs a staff call: URGENT first, then "Needs staff call",
// each group earliest first.
export async function getStaffCallList(): Promise<
  (AppointmentWithPatient & { doctorName: string })[]
> {
  const state = await loadState();
  const rank = (a: Appointment) => (a.status === "URGENT – staff call now" ? 0 : 1);
  return state.appointments
    .filter((a) => a.status === "URGENT – staff call now" || a.status === "Needs staff call")
    .sort((a, b) => rank(a) - rank(b) || byDayAndTime(a, b))
    .map((a) => ({
      ...withPatient(a),
      doctorName: doctors.find((d) => d.id === a.doctorId)!.name,
    }));
}

// Put this visitor's demo back to the starting data.
export async function resetDemo(): Promise<void> {
  await clearSteps();
}
