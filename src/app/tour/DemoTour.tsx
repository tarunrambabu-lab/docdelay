"use client";

// The guided demo tour (the screen part). The steps and their logic are in
// tourSteps.ts.
//
// - It starts ONLY from the "Take the 2-minute tour" button (TourStartButton).
// - "Start the tour" resets the demo, so the screen matches the tour.
// - The visitor does all the clicking: the tour puts a teal ring around the
//   button to press, and moves on by itself when the step is done.
// - "Skip tour" on every step; "Restart tour" at the end.
// - The step number is remembered in the browser tab (sessionStorage), so a
//   page refresh doesn't lose it. If that storage is blocked, the tour still
//   works but starts over after a refresh.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { resetDemoAction } from "@/app/actions";
import { TOUR_HOME, TOUR_STEPS, tourView, type TourScreen } from "./tourSteps";

const STORAGE_KEY = "docdelay-tour-step";

const TourContext = createContext<{ active: boolean; start: () => void }>({
  active: false,
  start: () => {},
});

// Is the tour running? (e.g. the "Mark unavailable" pop-up pre-fills its times then)
export const useTour = () => useContext(TourContext);

// Which data-tour markers are visible right now, and the chat outcome shown.
function readScreen(): TourScreen {
  const visible = [...document.querySelectorAll<HTMLElement>("[data-tour]")].filter(
    (el) => el.getClientRects().length > 0,
  );
  return {
    markers: new Set(visible.map((el) => el.dataset.tour!)),
    outcome: visible.find((el) => el.dataset.tour === "outcome")?.dataset.status,
  };
}

// The current step (null = no tour), kept in the browser tab's storage so a
// refresh doesn't lose it — or only in memory if that storage is blocked.
let memoryStep: number | null = null;
const listeners = new Set<() => void>();

function readStep(): number | null {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved !== null && TOUR_STEPS[Number(saved)] ? Number(saved) : null;
  } catch {
    return memoryStep; // storage blocked
  }
}

function writeStep(step: number | null) {
  memoryStep = step;
  try {
    if (step === null) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, String(step));
  } catch {
    // storage blocked: the tour still works, it just isn't remembered
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function TourProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // null = no tour. (On the server there's never a tour.)
  const step = useSyncExternalStore(subscribe, readStep, () => null);
  const [target, setTarget] = useState<string>();
  const [lost, setLost] = useState(false);
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const setStep = useCallback((next: number | null) => writeStep(next), []);

  // Watch the page: point at the right button, and move on when a step is done.
  // A step only counts as done after the tour has first seen it NOT done — so
  // an old screen (e.g. the red banner just before "Reset demo" takes effect)
  // can't skip a step.
  useEffect(() => {
    if (step === null) return;
    let frame = 0;
    let seenNotDone = false;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const view = tourView(step, readScreen());
        if (view.done && seenNotDone) {
          setStep(step + 1);
          return;
        }
        if (!view.done) seenNotDone = true;
        setTarget(view.target);
        setLost(view.lost);
        setReady(view.ready);
      });
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-status", "data-tour"],
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [step, setStep]);

  // Ring around the target, scrolled into view above the tour card.
  useEffect(() => {
    if (step === null || !target) return;
    const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find(
      (e) => e.getClientRects().length > 0,
    );
    if (!el) return;
    el.setAttribute("data-tour-active", "");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    return () => el.removeAttribute("data-tour-active");
  }, [step, target]);

  // Leave room at the bottom of the page for the card, so nothing hides behind it.
  useEffect(() => {
    if (step === null) return;
    const pad = () => {
      document.body.style.paddingBottom = `${(cardRef.current?.offsetHeight ?? 0) + 16}px`;
    };
    pad();
    window.addEventListener("resize", pad);
    return () => {
      window.removeEventListener("resize", pad);
      document.body.style.paddingBottom = "";
    };
  }, [step, lost]);

  // "Take the 2-minute tour" → the welcome step.
  const start = useCallback(() => setStep(0), [setStep]);

  // "Start the tour": reset the demo, go to the dashboard, step 2.
  const begin = async () => {
    setBusy(true);
    await resetDemoAction();
    router.push(TOUR_HOME, { scroll: true });
    setBusy(false);
    setStep(1);
  };

  const current = step === null ? undefined : TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;
  const button =
    "min-h-11 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50";

  return (
    <TourContext.Provider value={{ active: step !== null, start }}>
      {children}
      {current && (
        <div
          ref={cardRef}
          role="dialog"
          aria-label="Demo tour"
          className="fixed inset-x-0 bottom-0 z-30 max-h-[45vh] overflow-y-auto rounded-t-2xl border-t border-teal-200 bg-white p-4 shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96 sm:rounded-2xl sm:border"
        >
          <p className="text-xs font-medium text-teal-700">
            Tour · step {step! + 1} of {TOUR_STEPS.length}
          </p>
          <h2 className="mt-1 font-semibold text-slate-900">{current.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{current.text}</p>
          {lost && (
            <p className="mt-2 text-sm text-slate-600">
              This step happens on the dashboard.{" "}
              <Link
                href={TOUR_HOME}
                className="inline-flex min-h-11 items-center font-medium text-teal-700 underline"
              >
                Take me back
              </Link>
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {step === 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={begin}
                className={`${button} bg-teal-700 text-white hover:bg-teal-800`}
              >
                {busy ? "Resetting…" : current.nextLabel}
              </button>
            ) : current.nextLabel && ready ? (
              <button
                type="button"
                onClick={() => setStep(step! + 1)}
                className={`${button} bg-teal-700 text-white hover:bg-teal-800`}
              >
                {current.nextLabel}
              </button>
            ) : null}
            {last ? (
              <>
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className={`${button} bg-teal-700 text-white hover:bg-teal-800`}
                >
                  Restart tour
                </button>
                <button
                  type="button"
                  onClick={() => setStep(null)}
                  className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
                >
                  Explore on my own
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setStep(null)}
                className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
              >
                Skip tour
              </button>
            )}
          </div>
        </div>
      )}
    </TourContext.Provider>
  );
}

// The only way to start the tour.
export function TourStartButton({ className }: { className?: string }) {
  const { start } = useTour();
  return (
    <button type="button" onClick={start} className={className}>
      Take the 2-minute tour
    </button>
  );
}
