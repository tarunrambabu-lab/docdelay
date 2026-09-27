// Counting AI messages, to protect against runaway spending.
// Only used when the Claude engine is switched on (see index.ts).
//
// - Per visitor: a small cookie holding today's date and a count.
//   (A visitor could clear their cookies to reset it — the site-wide limit
//   and a spend limit in the Anthropic Console are the real backstops.)
// - Per site: a counter in this server's memory.
//   ⚠️ On Vercel there can be several server instances, each with its own
//   memory, and they restart often — so this is NOT yet a reliable site-wide
//   limit. BEFORE switching the AI on for the public: move this counter to a
//   shared store (e.g. a Redis database), AND set a monthly spend limit for
//   the API key in the Anthropic Console.

import { cookies } from "next/headers";
import { AI_MAX_MESSAGES_PER_SITE_PER_DAY, AI_MAX_MESSAGES_PER_VISITOR_PER_DAY } from "./settings";
import { HOSPITAL_TIME_ZONE } from "@/lib/time";

const VISITOR_COOKIE = "docdelay-ai-usage";

// Today's date in the hospital, e.g. "2026-09-27".
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: HOSPITAL_TIME_ZONE });

// Site-wide count for today (see the warning above).
const site = { day: "", count: 0 };

// Try to use one AI message. Returns "ok" (and counts it), or which limit is hit.
// Only works inside a Server Action (it updates a cookie).
export async function countOneAiMessage(): Promise<"ok" | "visitor limit" | "site limit"> {
  const day = today();
  const store = await cookies();
  const [savedDay, savedCount] = (store.get(VISITOR_COOKIE)?.value ?? "").split(":");
  const visitorCount = savedDay === day ? Number(savedCount) || 0 : 0;
  if (site.day !== day) Object.assign(site, { day, count: 0 });

  if (visitorCount >= AI_MAX_MESSAGES_PER_VISITOR_PER_DAY) return "visitor limit";
  if (site.count >= AI_MAX_MESSAGES_PER_SITE_PER_DAY) return "site limit";

  site.count++;
  store.set(VISITOR_COOKIE, `${day}:${visitorCount + 1}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // a day
  });
  return "ok";
}
