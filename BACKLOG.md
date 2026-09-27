# DocDelay — Backlog

Ideas and known gaps to pick up later.

## To do

- **A second "doctor unavailable" window on the same day:** the empty-slot search should avoid it. Right now, if a doctor has two absences in one day, a "later today" patient can be given a slot inside the second absence.
- **Before switching the AI on for the public:** move the site-wide AI message counter to a shared store (e.g. Redis) — on Vercel each server instance has its own memory, so today's in-memory counter isn't a reliable site-wide limit — and set a monthly spend limit for the API key in the Anthropic Console.
- **Native-speaker review:** the Tamil and Hindi call wording, text messages, chat replies and the chat keyword lists (`src/lib/understanding/rules.ts`) must be checked by native speakers before real use.

## Done

- ✅ **No room today → offer "another day" straight away (Stage 5):** when there's no room left today, the call now apologises and offers 3 other-day slots, instead of only saying "our front desk will call you".
- ✅ **Limit how far a patient is pushed (Stage 5):** an unaffected patient is never pushed more than `MAX_PUSH_MINUTES` (45 minutes) past their original booked time. If fitting a "later today" patient would break this, it counts as "no room today" and other days are offered.
