// Colours for each appointment status, and the short call summary text.
// Shared by the dashboard and the call simulator.

import type { AppointmentStatus, CallResult } from "@/hms/types";
import { CALL_RESULTS } from "@/hms/types";

// Tailwind classes for each status badge.
export const statusColors: Record<AppointmentStatus, string> = {
  Scheduled: "bg-slate-100 text-slate-700",
  "Affected – needs contact": "bg-red-100 text-red-700",
  "Wants later today": "bg-emerald-100 text-emerald-800",
  "Wants another day": "bg-blue-100 text-blue-800",
  Cancelled: "bg-zinc-200 text-zinc-600 line-through",
  "Needs staff call": "bg-orange-100 text-orange-800",
  "No answer": "bg-yellow-100 text-yellow-800",
};

// Short words used in the summary, e.g. "3 later today".
const summaryWords: Record<CallResult, string> = {
  "Wants later today": "later today",
  "Wants another day": "another day",
  Cancelled: "cancelled",
  "Needs staff call": "needs staff",
  "No answer": "no answer",
};

// "8 called: 3 later today, 2 another day, 1 cancelled"
// (answers nobody gave are left out). Returns "" if nobody has been called.
export function callSummary(statuses: AppointmentStatus[]): string {
  const called = statuses.filter((s): s is CallResult => CALL_RESULTS.includes(s as CallResult));
  if (called.length === 0) return "";
  const parts = CALL_RESULTS.map((result) => {
    const count = called.filter((s) => s === result).length;
    return count > 0 ? `${count} ${summaryWords[result]}` : null;
  }).filter(Boolean);
  return `${called.length} called: ${parts.join(", ")}`;
}
