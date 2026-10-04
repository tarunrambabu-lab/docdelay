// Shared data shapes for talking to a hospital system (HMS).
// Both the mock HMS and any future real HMS (FHIR or custom API)
// must return data in these shapes, so the rest of the app never changes.

export type Language = "English" | "Tamil" | "Hindi";

// What a patient pressed on a (simulated) call.
export const CALL_RESULTS = [
  "Wants later today",
  "Wants another day",
  "Cancelled",
  "Needs staff call",
  "No answer",
  // Buttons only. Added LAST on purpose: each saved demo step stores a
  // result by its position in this list (see visitorState.ts).
  "Wants another doctor today",
] as const;
export type CallResult = (typeof CALL_RESULTS)[number];

export type AppointmentStatus =
  | "Scheduled"
  | "Affected – needs contact"
  | "Rescheduled – later today" // patient pressed 1 and got a new time today
  | "Rescheduled – another day" // patient picked one of the other-day offers
  | "Cancelled"
  | "Needs staff call"
  | "No answer"
  | "Time moved" // pushed back to make room for a rescheduled patient
  | "Rebooked – another doctor" // pressed 5: now with an approved doctor of the same specialty, today
  | "URGENT – staff call now"; // patient mentioned a health concern — a person must call NOW

// How a patient's answer reached DocDelay.
export type Channel = "call" | "WhatsApp";

// One line in an appointment's call log.
export interface CallLogEntry {
  calledAt: string; // when the call happened (ISO date-time)
  channel?: Channel; // where it came from; left out = "call"
  result?: CallResult; // what the patient answered (empty for staff notes)
  detail?: string; // extra info, e.g. "Picked B: Tue 29 Sep, 9:45 AM"
}

// One line of a chat conversation (Chat mode in the call simulator).
export interface ChatTurn {
  at: string; // ISO date-time
  from: "patient" | "docdelay";
  text: string;
  // For patient lines: what DocDelay understood (e.g. "another_day: Thu, after 16:00").
  understood?: string;
  // WhatsApp only: the patient sent a voice note (`text` = what was heard) or
  // a photo (never read, so `text` is empty). Left out = a typed message.
  media?: WhatsAppMedia;
}

// A WhatsApp message that wasn't typed.
//   "voice" = a voice note: turned into text, then handled like a typed
//             message (health check first) — except that it can never be "STOP".
//   "photo" = a photo, document or sticker: DocDelay can't read it.
export type WhatsAppMedia = "voice" | "photo";

// A staff member said an URGENT flag was a false alarm.
export interface FalseAlarm {
  at: string; // ISO date-time
  by: string; // who marked it (the demo has no staff logins, so "Front desk")
}

// One line in an appointment's time-change history.
export interface TimeChange {
  changedAt: string; // ISO date-time
  oldDayOffset: number;
  oldStartTime: string; // "HH:MM"
  newDayOffset: number;
  newStartTime: string; // "HH:MM"
  // Only when the patient moved to a different doctor ("another doctor today").
  oldDoctorId?: string;
  newDoctorId?: string;
  why: string;
}

// An open slot on another day, offered to a patient on the phone.
export interface SlotOffer {
  dayOffset: number;
  startTime: string; // "HH:MM"
  doctorId?: string; // only for "another doctor today" offers: which doctor
}

export const UNAVAILABILITY_REASONS = ["Emergency surgery", "Personal emergency", "Other"] as const;
export type UnavailabilityReason = (typeof UNAVAILABILITY_REASONS)[number];

// A stretch of time today when a doctor can't see patients.
export interface Unavailability {
  id: string;
  doctorId: string;
  reason: UnavailabilityReason;
  fromTime: string; // "HH:MM"
  // "HH:MM" — the doctor's CURRENT expected return time (staff can change it).
  // ⚠️ Bookings don't read this directly: they use bookingsStartAt() in
  // lib/returnCheck.ts, which never goes earlier than the FIRST expected time.
  untilTime: string;
  affectedCount: number; // how many appointments fell inside the window
  // Every time staff changed the expected return time, oldest first. The
  // first line's `oldTime` is the time first entered.
  returnTimeChanges?: ReturnTimeChange[];
  // Staff pressed "Mark doctor available" (the doctor is physically back):
  // when it was pressed (ISO date-time). This ends the absence.
  markedAvailableAt?: string;
}

// One line in an absence's history: the expected return time was changed.
export interface ReturnTimeChange {
  changedAt: string; // ISO date-time
  oldTime: string; // "HH:MM"
  newTime: string; // "HH:MM"
}

// Step 1 of the waiting check: after staff enter a LATER return time, these
// are the patients whose time today now falls inside the longer absence.
// DocDelay only LISTS them for staff — nobody is contacted or moved.
export type InsideAbsenceGroup =
  | "Never contacted" // booked in the extra time; DocDelay hasn't contacted them
  | "Rebooked by DocDelay" // already given a new time, which is now inside the absence
  | "Pushed by DocDelay" // pushed back to a time that is now inside the absence
  | "Choosing a time"; // looking at an offer today that is now inside the absence

export interface InsideAbsenceRow {
  appointment: AppointmentWithPatient;
  group: InsideAbsenceGroup;
  time: string; // "HH:MM" — the time that is inside the absence
  // An update naming this time is waiting to be sent ("Send updates").
  unsentUpdate: boolean;
}

export interface Hospital {
  id: string;
  name: string;
  city: string;
}

export interface Doctor {
  id: string;
  name: string; // in English letters, e.g. "Dr. Meera Krishnan"
  specialty: string;
  // The name in Tamil / Hindi script, e.g. "டாக்டர் மீரா கிருஷ்ணன்". A real
  // HMS may or may not supply these; messages fall back to `name`.
  localNames?: { Tamil?: string; Hindi?: string };
  // Doctors this doctor is approved (by the hospital) to cover for, e.g.
  // ["doc-cardio"]. Only used if the specialty is the same, too.
  canCoverFor?: string[];
}

export interface Patient {
  id: string;
  name: string;
  phone: string;
  preferredLanguage: Language;
  // "WhatsApp OK": the patient agreed to get WhatsApp messages from the
  // hospital. Only these patients are ever contacted on WhatsApp.
  whatsappOptIn?: boolean;
  // Demo only: WhatsApp messages to this patient don't arrive, so their update
  // falls back to a text message (SMS).
  whatsappFails?: boolean;
}

export interface Appointment {
  id: string;
  doctorId: string;
  patientId: string;
  dayOffset: number; // 0 = today, 1 = tomorrow, … (up to 7)
  startTime: string; // "HH:MM", 24-hour clock
  endTime: string; // "HH:MM"
  reason: string;
  status: AppointmentStatus;
  unavailabilityId?: string; // which "doctor unavailable" event affected it
  note?: string; // e.g. "No room today"
  callLog?: CallLogEntry[]; // only there once the patient has been called
  timeHistory?: TimeChange[]; // only there once its time has changed
  // Other-day slots offered on the phone, waiting for the patient to pick one.
  offers?: SlotOffer[];
  // Pressed 2, pressed 1 but today was full, or pressed 5 (offers with another doctor today).
  offersBecause?: "asked" | "no room today" | "another doctor";
  // Pressed 5, but the chosen slot was just taken and no other was left: back
  // to the 1–4 menu, which starts with "Sorry, that time was just taken".
  slotJustTaken?: boolean;
  // Buttons: the slot they picked was refused because that doctor's expected
  // return time is now later than the slot. The next thing they hear starts
  // with "Sorry, Dr. … will now be back at [backAt], so that time is no
  // longer available" (instead of "…just taken").
  doctorBackLater?: { doctorId: string; backAt: string };
  chat?: ChatTurn[]; // the full chat, if the call was done in Chat mode
  unclearInARow?: number; // chat replies in a row that couldn't be understood
  // A time the patient gave without a day ("after 4"), kept while DocDelay
  // asks "today, or another day?".
  timeWish?: { timeOfDay?: "morning" | "afternoon" | "evening"; after?: string; before?: string };
  falseAlarms?: FalseAlarm[]; // URGENT flags that staff marked as false alarms

  // ----- WhatsApp (simulated) -----
  whatsapp?: ChatTurn[]; // the WhatsApp conversation for this appointment
  // The patient started answering on WhatsApp but hasn't finished: a call
  // reaches them last (see getCallQueue).
  whatsappStarted?: boolean;
  // The patient sent "STOP": the WhatsApp chat is closed for this appointment.
  whatsappStopped?: boolean;
  // Set when the patient's latest finished answer came on WhatsApp
  // (left out = it came on a call).
  answeredVia?: Channel;
  answerChanges?: number; // how many times the patient changed a finished answer (at most 2)
  // A change of answer the patient has started on WhatsApp but not finished.
  // Their booking stays as it is until the new answer is finished.
  change?: {
    offers?: SlotOffer[];
    offersBecause?: "asked" | "no room today" | "another doctor";
    timeWish?: Appointment["timeWish"];
  };
  // An update ("Reply 1 to confirm, 2 to change") was sent: until the patient
  // replies 2, a bare "1" means "confirmed" — NOT "1 – later today".
  awaitingUpdateReply?: boolean;
  // Pushed patients only: the heads-up ("Reply 1 if that's fine, 2 to cancel,
  // 3 to talk to a person") was sent, so their replies are read against it.
  headsUpSent?: boolean;
  // …and DocDelay has asked "Reply YES to cancel" and is waiting for the answer.
  headsUpCancelAsked?: boolean;
  // The status before a WhatsApp health mention made it URGENT (when it wasn't
  // "Affected – needs contact"), so a false alarm puts it back.
  statusBeforeUrgent?: AppointmentStatus;
}

// An appointment with its patient's details attached — handy for screens.
export interface AppointmentWithPatient extends Appointment {
  patient: Patient;
}

// A text message waiting to be sent. There is at most ONE per appointment,
// and it always holds the latest new time — so a patient who is moved several
// times gets a single message with their final time.
export interface PendingUpdate {
  appointmentId: string;
  newDayOffset: number; // the latest day
  newStartTime: string; // "HH:MM" — the latest time
  reason: UnavailabilityReason; // why the doctor was unavailable (for the wording)
  updatedAt: string; // ISO date-time of the latest change
  // A patient who wasn't affected but was pushed back to make room: they get a
  // short heads-up ("Reply 1 if that's fine, 2 to cancel, 3 to talk to a person")
  // instead of "Reply 1 to confirm, 2 to change".
  headsUp?: boolean;
}

// A pending update with the appointment and patient details attached.
export interface PendingUpdateWithDetails extends PendingUpdate {
  appointment: AppointmentWithPatient;
}

// A simulated update message — a text (SMS) or a WhatsApp message. Nothing is
// really sent. A patient gets ONE per update, on one channel, never both.
export interface SmsMessage {
  id: string;
  channel: "SMS" | "WhatsApp";
  // WhatsApp was tried first and failed, so this went by SMS instead.
  // (A real system would wait 15 minutes; the demo falls back straight away.)
  whatsappFailed?: boolean;
  headsUp?: boolean; // the heads-up for a pushed patient (replies: 1 fine, 2 cancel, 3 person)
  sentAt: string; // ISO date-time
  appointmentId: string;
  toName: string;
  toPhone: string;
  language: Language;
  text: string;
}
