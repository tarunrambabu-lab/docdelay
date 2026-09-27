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
import { clearSteps, isNearlyFull, readSteps, writeSteps, type DemoStep } from "./visitorState";
import {
  anchorTime,
  findOtherDaySlots,
  isClosedDay,
  listFreeSlots,
  originalTimeOf,
  pickClosest,
  pickOffers,
  planLaterToday,
  SLOT_MINUTES,
  type SlotQuery,
} from "@/lib/reschedulingRules";
import {
  anotherDayReply,
  callScript,
  laterTodayReply,
  OFFER_LETTERS,
  otherDayOffersScript,
} from "@/lib/callScript";
import {
  cancelledReply,
  noMatchPrefix,
  slotTakenPrefix,
  staffWillCallReply,
  unclearReply,
  urgentReply,
} from "@/lib/chatReplies";
import { describeUnderstanding } from "@/lib/understanding/describe";
import type { Preferences, Understanding } from "@/lib/understanding/types";
import { timeChangedSms } from "@/lib/smsText";
import { formatTime, formatWhen, fromMinutes, toMinutes } from "@/lib/time";

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
        doctorName: doctor.name,
        reason: update.reason,
        newDayOffset: update.newDayOffset,
        newTime: formatTime(update.newStartTime),
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
// with a reason. (A "later today" push is never done here — that only
// happens through the "Later today" answer and its own rules.)
export async function bookSlot(appointmentId: string, slot: SlotOffer): Promise<BookResult> {
  const steps = await readSteps();
  const step: DemoStep = { kind: "book", at: Date.now(), appointmentId, ...slot };
  const result = applyBook(replay(steps), step);
  if (!result.ok) return result;
  return (await writeSteps([...steps, step]))
    ? result
    : { ok: false, reason: "This demo has too much history. Press “Reset demo”." };
}

function applyBook(state: HmsState, step: Extract<DemoStep, { kind: "book" }>): BookResult {
  const appt = state.appointments.find((a) => a.id === step.appointmentId);
  if (!appt) return { ok: false, reason: "Unknown appointment." };
  const slot = { dayOffset: step.dayOffset, startTime: step.startTime };
  const result = bookSlotIn(state, appt, slot, step.at);
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
//     same slot, the first one wins and the second is refused.
function bookSlotIn(state: HmsState, appt: Appointment, slot: SlotOffer, at: number): BookResult {
  if (appt.status !== "Affected – needs contact") {
    return { ok: false, reason: "This patient isn't waiting for a new time." };
  }
  const unavailability = state.unavailabilities.find((u) => u.id === appt.unavailabilityId);
  if (!unavailability) return { ok: false, reason: "Unknown doctor unavailability." };

  const free = listFreeSlots(
    state.appointments.filter((a) => a.doctorId === appt.doctorId),
    { days: [slot.dayOffset] },
    { excludeAppointmentId: appt.id, todayFrom: unavailability.untilTime },
  );
  if (!free.some((f) => f.startTime === slot.startTime)) {
    return { ok: false, reason: "That slot isn't free any more (or it's outside the rules)." };
  }

  const today = slot.dayOffset === 0;
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

// Offers for a chat request: real free slots matching the wish; if none
// match, the closest real free slots. Returns an empty list if the doctor
// has no free slot at all in the coming days.
function chatOffers(
  state: HmsState,
  appt: Appointment,
  wish: Preferences,
): { matched: boolean; offers: SlotOffer[] } {
  const doctorsAppointments = state.appointments.filter((a) => a.doctorId === appt.doctorId);
  const exclude = { excludeAppointmentId: appt.id };
  const day = wish.dayOffset;
  const wantedDay = day !== undefined && day > 0 ? day : undefined;
  const anchor = anchorTime(wish, originalTimeOf(appt));

  const query: SlotQuery = {
    days: day !== undefined ? [day] : undefined,
    timeOfDay: wish.timeOfDay,
    after: wish.after,
    before: wish.before,
  };
  const matching = listFreeSlots(doctorsAppointments, query, exclude);
  if (matching.length > 0) {
    return {
      matched: true,
      // One day asked for → the best 3 on that day; otherwise one per day.
      offers:
        query.days?.length === 1
          ? pickClosest(matching, { dayOffset: wantedDay, time: anchor })
          : pickOffers(matching, anchor),
    };
  }
  const anyFree = listFreeSlots(doctorsAppointments, {}, exclude);
  return { matched: false, offers: pickClosest(anyFree, { dayOffset: wantedDay, time: anchor }) };
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
    say(
      appt.offers
        ? otherDayOffersScript(language, appt.offers, appt.offersBecause === "no room today")
        : callScript({
            language,
            patientName: patient.name,
            hospitalName: hospital.name,
            doctorName: doctor.name,
            reason: unavailability.reason,
            appointmentTime: formatTime(appt.startTime),
            untilTime: formatTime(unavailability.untilTime),
          }),
    );
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

    case "later_today": {
      if (appt.offers && appt.offersBecause === "no room today") {
        // Today is still full — repeat the other-day offers.
        say(otherDayOffersScript(language, appt.offers, true));
        return true;
      }
      const noRoomBecause = rescheduleLaterToday(state, appt, step.at);
      if (!noRoomBecause) {
        dropOffers();
        say(laterTodayReply(language, formatTime(appt.startTime)));
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
      const { matched, offers } = chatOffers(state, appt, u.preferences);
      if (offers.length === 0) {
        appt.status = "Needs staff call";
        appt.note = "No free slot in the next days";
        dropOffers();
        say(staffWillCallReply(language));
        log("Wants another day", "no free slot in the next days");
        return true;
      }
      appt.offers = offers;
      appt.offersBecause = "asked";
      const script = otherDayOffersScript(language, offers, false);
      say(matched ? script : `${noMatchPrefix(language)} ${script}`);
      return true;
    }

    case "choose_offer": {
      const offer = u.offerIndex !== undefined ? appt.offers?.[u.offerIndex] : undefined;
      if (!offer) return unclear();
      if (bookSlotIn(state, appt, offer, step.at).ok) {
        say(
          offer.dayOffset === 0
            ? laterTodayReply(language, formatTime(offer.startTime))
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
