// A short, staff-facing description of what a chat message was understood to
// mean, e.g. "another day · Thu 1 Oct · after 4:00 PM". Shown in the chat log.

import type { Understanding } from "./types";
import { OFFER_LETTERS } from "@/lib/callScript";
import { formatDate, formatTime } from "@/lib/time";

export function describeUnderstanding(u: Understanding): string {
  const p = u.preferences;
  return [
    u.intent.replace(/_/g, " "),
    u.offerIndex !== undefined ? `option ${OFFER_LETTERS[u.offerIndex]}` : "",
    p.dayOffset !== undefined
      ? p.dayOffset < 0
        ? "a day beyond the next week"
        : formatDate(p.dayOffset)
      : "",
    p.timeOfDay ?? "",
    p.after ? `after ${formatTime(p.after)}` : "",
    p.before ? `before ${formatTime(p.before)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
