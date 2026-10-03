// The guided demo tour: its steps, wording, and where each step points.
// Plain logic only (no screen code), so it can be tested — see tourSteps.test.ts.
// The screen part is DemoTour.tsx.
//
// How the tour "sees" the page: buttons it points at carry a data-tour="…"
// marker (e.g. data-tour="mark-unavailable"). The tour reads which markers are
// on screen right now (a TourScreen) and decides:
//   - target: which marker to put a ring around,
//   - done: whether the visitor has finished this step (then it moves on).
// If a step's target isn't on screen, the tour offers "Take me back".

// During the tour, "Mark doctor unavailable" pre-fills these times, so the
// tour works whatever the time of day (the visitor can still change them).
export const TOUR_UNAVAILABLE = { fromTime: "09:00", untilTime: "12:00" };

// Where "Take me back" goes: the dashboard, Dr. Meera Krishnan, today.
export const TOUR_HOME = "/?doctor=doc-cardio&day=0";

// The WhatsApp step uses Revathi Krishnan (10:00 AM, Tamil, "WhatsApp OK"):
// the next patient still waiting after the earlier steps. Her row's "Open
// WhatsApp" link carries the "tour-whatsapp-link" marker.
export const TOUR_WHATSAPP_APPOINTMENT = "appt-005";

export interface TourScreen {
  markers: Set<string>; // every data-tour marker on screen
  outcome?: string; // the chat outcome shown, e.g. "URGENT – staff call now"
}

export interface TourStep {
  title: string;
  text: string;
  nextLabel?: string; // steps with a button to move on; the others move on by themselves
  ready?: (screen: TourScreen) => boolean; // the button only shows once this is on screen
  target?: (screen: TourScreen) => string | undefined;
  done?: (screen: TourScreen) => boolean;
}

// The outcome the Buttons-mode result shows after "5 – Another doctor today".
const REBOOKED = "Rebooked – another doctor";

// Get a patient to press "5 – Another doctor today" (Buttons mode), then pick
// a time with the other doctor. Anything else the visitor presses (1–4, "Didn't
// pick up", a chat reply) just moves the ring on to the next affected patient:
//   - an outcome on screen → "Next patient";
//   - other-day times on screen (after 2, or 1 with no room today) → the first
//     time, which books it and shows "Next patient";
//   - Chat on screen → the "Buttons" tab.
function towardsAnotherDoctor(s: TourScreen): string | undefined {
  if (s.outcome === REBOOKED) return "outcome"; // done: show the "was → now" line
  if (s.markers.has("another-doctor-pick")) return "another-doctor-pick";
  if (s.markers.has("another-doctor")) return "another-doctor";
  if (s.markers.has("day-offer-pick")) return "day-offer-pick";
  if (s.outcome && s.markers.has("next-patient")) return "next-patient";
  if (s.markers.has("chat-box") && s.markers.has("buttons-tab")) return "buttons-tab";
  if (s.markers.has("start-calling")) return "start-calling";
  return undefined;
}

// Go to the first patient's chat: "Start calling patients", then "Chat".
function towardsChat(s: TourScreen): string | undefined {
  if (s.markers.has("chat-box")) return undefined;
  if (s.markers.has("chat-tab")) return "chat-tab";
  if (s.markers.has("start-calling")) return "start-calling";
  if (s.markers.has("back-to-dashboard")) return "back-to-dashboard";
  return undefined;
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to DocDelay",
    text:
      "When a doctor is suddenly called into emergency surgery, DocDelay contacts every affected " +
      "patient and helps them choose: wait for a later time today, move to another day, cancel, or " +
      "see another doctor today. " +
      "Everything here is fictional (hospital, doctors, patients), and calls and texts are " +
      "simulated in your browser. Starting the tour resets the demo.",
    nextLabel: "Start the tour",
  },
  {
    title: "A doctor is called away",
    text:
      "Dr. Meera Krishnan has just been called into emergency surgery. Tap “Mark doctor " +
      "unavailable”, then “Mark unavailable”.",
    target: (s) =>
      s.markers.has("confirm-unavailable")
        ? "confirm-unavailable"
        : s.markers.has("mark-unavailable")
          ? "mark-unavailable"
          : undefined,
    done: (s) => s.markers.has("banner"),
  },
  {
    title: "Affected patients turn red",
    text:
      "Every patient booked while the doctor is away is now marked red. When patients pick a new " +
      "time, DocDelay follows fair rules: free slots first, nobody already booked is pushed more " +
      "than 45 minutes, and nothing after 7 PM.",
    nextLabel: "Next",
    ready: (s) => s.markers.has("appointments"),
    target: (s) => (s.markers.has("appointments") ? "appointments" : undefined),
  },
  {
    title: "Talk to the first patient",
    text:
      "Tap “Start calling patients”, then “Chat”. You play the patient. Tap the reply “I'll wait " +
      "for a later time today”.",
    target: (s) =>
      s.outcome
        ? undefined
        : s.markers.has("offer-pick") // no room today: other days were offered instead
          ? "offer-pick"
          : s.markers.has("reply-later_today")
            ? "reply-later_today"
            : towardsChat(s),
    done: (s) => Boolean(s.outcome),
  },
  {
    title: "A patient mentions a symptom",
    text:
      "Tap “Next patient”. This patient speaks Tamil. Tap the example “thala suthudhu” (I feel " +
      "dizzy). DocDelay stops rescheduling, tells the patient to call 108 in an emergency, and " +
      "flags them for an immediate staff call. It never judges how serious a symptom is.",
    target: (s) =>
      s.outcome
        ? s.markers.has("next-patient")
          ? "next-patient"
          : undefined
        : s.markers.has("symptom-example")
          ? "symptom-example"
          : towardsChat(s),
    done: (s) => s.outcome === "URGENT – staff call now",
  },
  {
    title: "Another doctor, same day",
    text:
      "Tap “Next patient”, then “Buttons” at the top. Tap “5 – Another doctor today” and pick any " +
      "time with Dr. Karthik Raman, the hospital's other cardiologist. Only doctors the hospital " +
      "has approved are offered, in empty slots, so nobody else moves.",
    nextLabel: "Next",
    // "Next" shows once the booking is made, so the "was → now" line can be read.
    ready: (s) => s.outcome === REBOOKED,
    target: towardsAnotherDoctor,
  },
  {
    title: "Patients can also answer on WhatsApp",
    text:
      "Tap “Back to dashboard”. Patients marked “WhatsApp OK” get a WhatsApp message too. Tap " +
      "“Open WhatsApp” on Revathi Krishnan's row, then tap “1 – Later today”. Her messages are " +
      "in Tamil; the buttons are in English.",
    // Back to the dashboard → Revathi's "Open WhatsApp" → "1 – Later today"
    // (or, if there's no room today, the first other-day time).
    target: (s) =>
      s.markers.has("whatsapp-offer-pick")
        ? "whatsapp-offer-pick"
        : s.markers.has("whatsapp-later-today")
          ? "whatsapp-later-today"
          : s.markers.has("tour-whatsapp-link")
            ? "tour-whatsapp-link"
            : s.markers.has("back-to-dashboard")
              ? "back-to-dashboard"
              : undefined,
    done: (s) => s.markers.has("whatsapp-answered"),
  },
  {
    title: "The staff call list",
    text:
      "Back on the dashboard, patients who need a person are listed at the top, URGENT first. " +
      "Scroll down to see the first patient's new time, shown as “was → now”.",
    nextLabel: "Next",
    // The WhatsApp screen's "Back to dashboard" opens the patient's details:
    // close them first, so the list can be seen.
    ready: (s) => s.markers.has("staff-list") && !s.markers.has("close-details"),
    target: (s) =>
      s.markers.has("close-details")
        ? "close-details"
        : s.markers.has("staff-list")
          ? "staff-list"
          : s.markers.has("back-to-dashboard")
            ? "back-to-dashboard"
            : undefined,
  },
  {
    title: "One update per patient",
    text:
      "Time changes wait here until staff approve them, so each patient gets one update with " +
      "their latest time — on WhatsApp if they agreed to it, otherwise by text. Tap “Messages”, " +
      "then “Send updates”.",
    target: (s) =>
      s.markers.has("send-updates")
        ? "send-updates"
        : s.markers.has("messages-link")
          ? "messages-link"
          : s.markers.has("back-to-dashboard")
            ? "back-to-dashboard"
            : undefined,
    done: (s) => s.markers.has("sent-message"),
  },
  {
    title: "That's DocDelay",
    text:
      "Every patient told within minutes. Staff get only the ones who need them. (In this demo, " +
      "calls and texts are simulated.)",
  },
];

// What the tour shows for a step on the current screen.
export function tourView(
  stepIndex: number,
  screen: TourScreen,
): { target?: string; done: boolean; lost: boolean; ready: boolean } {
  const step = TOUR_STEPS[stepIndex];
  const done = step.done?.(screen) ?? false;
  const target = done ? undefined : step.target?.(screen);
  // "Lost" = this step points at something, but it isn't on screen.
  const lost = !done && Boolean(step.target) && !target;
  // "Ready" = the step's button (e.g. "Next") can show: what it explains is on screen.
  const ready = step.ready?.(screen) ?? true;
  return { target, done, lost, ready };
}
