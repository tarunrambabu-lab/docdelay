// PLACEHOLDER for the Claude-powered understanding engine.
// NOT BUILT YET — no API is called. If this engine is ever switched on before
// it's finished, it throws, and the app falls back to Buttons mode with a
// notice (see index.ts).
//
// TODO (when an Anthropic API key is available):
//   1. `npm install @anthropic-ai/sdk`, and set ANTHROPIC_API_KEY on Vercel
//      (Project → Settings → Environment Variables). Never commit the key.
//   2. Implement understandWithClaude below with ONE Messages API call:
//        - model: AI_MODEL from ./settings ("claude-haiku-4-5")
//        - a system prompt that explains the task and the rules below
//        - the patient's message + context.offers (label them A/B/C with
//          their day and time) + context.language
//        - structured outputs, so the reply is always valid JSON matching the
//          Understanding type in ./types:
//            output_config: { format: { type: "json_schema", schema: <schema> } }
//          (or client.messages.parse(...), which validates it for you)
//        - a small max_tokens (the answer is a short JSON object)
//   3. Rules the prompt must spell out:
//        - Only classify. Never write replies to the patient, never invent
//          times or slots, never give medical advice.
//        - ANY mention of a symptom or health worry → "health_concern".
//          When unsure whether something is health-related → "health_concern".
//        - Dates/weekdays → dayOffset (0 = today, … 7), times → "HH:MM".
//   4. Validate the returned JSON again here (intent must be one of INTENTS)
//      and throw if it's wrong — index.ts then falls back safely.
//   5. Switch UNDERSTANDING_ENGINE to "claude" in ./settings. Nothing else
//      in the app needs to change.
//
// The rule-based health check still runs BEFORE this engine (see index.ts),
// so obvious health concerns are escalated without even calling the AI.

import type { Understander } from "./types";

export const understandWithClaude: Understander = async () => {
  throw new Error("The Claude understanding engine is not built yet (see TODO in claude.ts).");
};
