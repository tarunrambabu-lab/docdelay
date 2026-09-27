// SETTINGS for chat mode's "understanding" layer and for AI spending.
// All AI-related settings live here, in one place.

// Which engine turns a patient's chat message into an intent:
//   "rules"  = the free, rule-based stand-in (keyword matching) — used today.
//   "claude" = Claude Haiku via the Anthropic API — NOT built yet (see claude.ts).
// Switching to "claude" is the ONLY change needed once claude.ts is finished.
// Even then, the AI is only used if the ANTHROPIC_API_KEY environment variable
// is set; without a key the app quietly keeps using "rules".
export const UNDERSTANDING_ENGINE: "rules" | "claude" = "rules";

// The Claude model the AI version will use.
export const AI_MODEL = "claude-haiku-4-5";

// Spending protection — ONLY applies when the AI engine is actually in use.
// When a limit is hit (or the AI errors), the call simulator switches to
// Buttons mode with a small notice.
export const AI_MAX_MESSAGES_PER_VISITOR_PER_DAY = 10;
export const AI_MAX_MESSAGES_PER_SITE_PER_DAY = 200;
