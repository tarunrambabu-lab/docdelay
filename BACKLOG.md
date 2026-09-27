# DocDelay — Backlog

Ideas and known gaps to pick up later.

## To do

- **A second "doctor unavailable" window on the same day:** the empty-slot search should avoid it. Right now, if a doctor has two absences in one day, a "later today" patient can be given a slot inside the second absence.
- **Before switching the AI on for the public:** move the site-wide AI message counter to a shared store (e.g. Redis) — on Vercel each server instance has its own memory, so today's in-memory counter isn't a reliable site-wide limit — and set a monthly spend limit for the API key in the Anthropic Console.
- **Native-speaker review:** the Tamil and Hindi call wording, text messages, chat replies and the chat keyword lists (`src/lib/understanding/rules.ts`) must be checked by native speakers before real use.

## Revisit with the real AI

- **Offers after "[Day] is full" can include an EARLIER day** (e.g. "Thursday is full" → Tuesday offered). A patient who can only come later in the week might pick one without noticing.
- **"Thursday before 8" doesn't lead with Thursday:** outside-clinic-hours requests on a named day offer the closest slots one per day from that day on, instead of putting the named day first.
- **Fixed Tamil/Hindi month names:** dates come from the server's built-in formatting, which varies by server (e.g. Hindi "अक्तूबर" locally vs "अक्टूबर" on Vercel). Use fixed month-name lists so patients always see the same spelling.
- **Hospital name in local script:** Tamil and Hindi messages still show "Sunrise Multispeciality Hospital" in English letters — store a local-script name (like the doctors' `localNames`) and show it with the English in brackets.
- **Native-speaker check of doctor names and time-of-day boundaries:** the Tamil/Hindi spellings of the doctors' names (`localNames` in mockData.json), and where morning / afternoon / evening / night begin (`formatTimeFor` in src/lib/time.ts — e.g. whether 3:45 PM is மதியம் or மாலை).

## Minor assumptions

Logged from reports (see the rule in CLAUDE.md). Fine for now; revisit if they cause trouble.

- "Morning" requests must end by 12:00 PM and "afternoon" by 4:00 PM — treated like "before X".
- A named day the clinic is closed on (Sunday) gets "The clinic is closed on …" instead of "… is full at that time".
- Staff screens (staff call list, call-simulator header, Buttons screen) stay in English.
- AI chat: after an outcome (booked / waiting / cancelled / staff / urgent), DocDelay sends its own fixed confirmation line instead of AI-written text, so the AM/PM and local-time-word rules are always met. (It also saves one API call.)
- AI chat: when the daily AI message limit is hit, the simulator switches to Buttons (as before); when the AI errors or its reply fails the checks, only that message falls back to the rule-based stand-in.
- AI chat: in one turn the AI may check slots more than once; all slots offered in that turn are kept (up to 5, A–E). E.g. "kal subah ya parso shaam" also got a day-after-tomorrow morning option.
- AI chat: Tamil/Hindi replies may mix in English words (e.g. "Thursday") around the exact slot text.
- AI chat: the prompt (≈2,300 tokens) is below the minimum size for prompt caching on Haiku 4.5, so each call pays full input price (≈$0.003 per API call).

## Done

- ✅ **No room today → offer "another day" straight away (Stage 5):** when there's no room left today, the call now apologises and offers 3 other-day slots, instead of only saying "our front desk will call you".
- ✅ **Limit how far a patient is pushed (Stage 5):** an unaffected patient is never pushed more than `MAX_PUSH_MINUTES` (45 minutes) past their original booked time. If fitting a "later today" patient would break this, it counts as "no room today" and other days are offered.
