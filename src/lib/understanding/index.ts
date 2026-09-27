// Entry points for Chat mode's understanding layer.
//
//   - activeEngine(): is the AI on? (Only if it's chosen in settings AND an
//     API key is set — so the live site, which has no key, stays rule-based.)
//   - interpretWithRules(): the free rule-based stand-in (health check first).
//   - The AI path itself is in aiChat.ts (it talks and uses the hms tools).

import { mentionsHealth, understandWithRules } from "./rules";
import { UNDERSTANDING_ENGINE } from "./settings";
import type { Understanding, UnderstandingContext } from "./types";

export type { Understanding, UnderstandingContext } from "./types";
export { mentionsHealth } from "./rules";

export function activeEngine(): "rules" | "claude" {
  return UNDERSTANDING_ENGINE === "claude" && process.env.ANTHROPIC_API_KEY ? "claude" : "rules";
}

// The rule-based stand-in. Safety first: any health words → escalate at once.
export async function interpretWithRules(
  message: string,
  context: UnderstandingContext,
): Promise<Understanding> {
  if (mentionsHealth(message)) return { intent: "health_concern", preferences: {} };
  return understandWithRules(message, context);
}
