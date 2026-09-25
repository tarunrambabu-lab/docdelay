// Colours for each appointment status, the short call summary text, and the
// "was → now" line. Shared by the dashboard, call simulator and messages.

import type { Appointment, AppointmentStatus } from "@/hms/types";
import { formatTime, formatWhen } from "@/lib/time";

// Tailwind classes for each status badge.
export const statusColors: Record<AppointmentStatus, string> = {
  Scheduled: "bg-slate-100 text-slate-700",
  "Affected – needs contact": "bg-red-100 text-red-700",
  "Rescheduled – later today": "bg-emerald-100 text-emerald-800",
  "Rescheduled – another day": "bg-blue-100 text-blue-800",
  Cancelled: "bg-zinc-200 text-zinc-600 line-through",
  "Needs staff call": "bg-orange-100 text-orange-800",
  "No answer": "bg-yellow-100 text-yellow-800",
  "Time moved": "bg-cyan-100 text-cyan-800",
};

// Short words used in the summary, e.g. "3 later today". Statuses not
// listed here (not yet called, etc.) aren't counted as "called".
const summaryWords: Partial<Record<AppointmentStatus, string>> = {
  "Rescheduled – later today": "later today",
  "Rescheduled – another day": "another day",
  Cancelled: "cancelled",
  "Needs staff call": "needs staff",
  "No answer": "no answer",
};

// "8 called: 3 later today, 2 another day, 1 cancelled"
// (outcomes nobody got are left out). Returns "" if nobody has been called.
export function callSummary(statuses: AppointmentStatus[]): string {
  const called = statuses.filter((s) => s in summaryWords);
  if (called.length === 0) return "";
  const parts = Object.entries(summaryWords)
    .map(([status, word]) => {
      const count = called.filter((s) => s === status).length;
      return count > 0 ? `${count} ${word}` : null;
    })
    .filter(Boolean);
  return `${called.length} called: ${parts.join(", ")}`;
}

// "was 9:00 AM → now 11:00 AM" (moved within the same day), or
// "was Today 10:00 AM → now Mon 28 Sep, 10:15 AM" (moved to another day).
// Returns "" if the appointment never moved.
export function describeTimeChange(appt: Appointment): string {
  const first = appt.timeHistory?.[0];
  if (!first) return "";
  return first.oldDayOffset === appt.dayOffset
    ? `was ${formatTime(first.oldStartTime)} → now ${formatTime(appt.startTime)}`
    : `was ${formatWhen(first.oldDayOffset, first.oldStartTime)} → now ${formatWhen(appt.dayOffset, appt.startTime)}`;
}
