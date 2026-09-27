// SETTINGS for chat mode and for AI spending. All AI-related settings live here.

// Which engine handles Chat mode:
//   "claude" = Claude Haiku via the Anthropic API (see claude.ts and aiChat.ts)
//              — but ONLY if the ANTHROPIC_API_KEY environment variable is set.
//              Without a key (e.g. on the live Vercel site) the app quietly
//              uses the free rule-based stand-in instead.
//   "rules"  = always the free, rule-based stand-in (keyword matching).
export const UNDERSTANDING_ENGINE: "rules" | "claude" = "claude";

// The Claude model the AI uses (Claude Haiku 4.5 — fast and low-cost).
export const AI_MODEL = "claude-haiku-4-5";

// Keep replies short and cheap. (Tamil and Hindi need more tokens per word
// than English, so this leaves room for 3 offers in those languages.)
export const AI_MAX_OUTPUT_TOKENS = 500;
// At most this many API calls for one patient message (the AI may call a
// tool, see the result, and call another).
export const AI_MAX_CALLS_PER_MESSAGE = 4;
// Give up (and use the rule-based stand-in for that message) after this long.
export const AI_TIMEOUT_MS = 20_000;

// Price of the model in US dollars per million tokens — only used to show
// the estimated cost of each AI message in the server log.
// (Claude Haiku 4.5: $1 input, $5 output. Check anthropic.com/pricing.)
export const AI_PRICE_PER_MILLION_TOKENS = { input: 1, output: 5 };

// Spending protection — ONLY applies when the AI engine is actually in use.
// When a limit is hit, the call simulator switches to Buttons mode with a
// small notice.
export const AI_MAX_MESSAGES_PER_VISITOR_PER_DAY = 10;
export const AI_MAX_MESSAGES_PER_SITE_PER_DAY = 200;
