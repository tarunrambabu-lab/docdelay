# DocDelay — Handoff

Last updated: 29 Sep 2026. Read this first when starting a new chat or a new Claude Code session.

## What DocDelay is

An add-on for hospital systems that reschedules a doctor's patients when the doctor is suddenly unavailable (e.g. pulled into emergency surgery). It finds every affected patient, contacts them in English, Tamil or Hindi, and rebooks them fairly for later today or another day, or cancels.

## Key links

| What | Link |
| --- | --- |
| Live demo | https://docdelay-three.vercel.app |
| Code (GitHub) | https://github.com/tarunrambabu-lab/docdelay |
| FRD (every feature, rule, decision) | https://claude.ai/code/artifact/7d6ed743-f25b-42d4-81f4-da28c38083f9 |
| Roadmap to a saleable product | https://claude.ai/code/artifact/b597391c-b2a0-4666-b917-5bcf1858e021 |

## Where things stand

| Stage | Status |
| --- | --- |
| 1–5: dashboard, doctor unavailable, simulated calls (3 languages), fair rescheduling, one text per patient | Done |
| Live site on Vercel, GitHub README, screenshots, copyright notice | Done |
| 6: chat mode | Done. Live site = basic word-list chat. Laptop = real AI (Claude Haiku 4.5) using my API key in `.env.local` |
| Safety: wide health-keyword check runs first; "two unclear replies" counted in code | Done |
| Alarm-fatigue fix ("tired of waiting", "heavy traffic", "work pressure", remove "doctor said") | Done |
| 7: guided demo tour, suggested chat phrases, phone-width polish | Next |
| Real calls to my own phone | After Stage 7 |
| Demo video | After real calls |

Roadmap position: finishing Phase 1 (Finish MVP). Phase 2 = interview 15+ clinics.

## Rules we've agreed (don't change without asking me)

- The AI only talks; the rules in the HMS module make every booking decision.
- Later today: empty slots first, then push, max 45 minutes for any unaffected patient, nothing after 7 PM.
- A patient's chosen time never pushes anyone; chosen times only up to 5 PM.
- Other days: empty slots only, one offer per day; bookings on other days are never moved.
- Any health mention → URGENT, straight to staff. The app never judges severity. Escalation gives no booking advantage.
- One text per patient, sent only when staff approve.
- Chat rules are frozen for the MVP; new edge cases go to BACKLOG.md.

## How I like to work

- Explain things simply, step by step.
- Assumptions are fine, but flag any that could risk patient safety, book the wrong slot or move someone unfairly, or confuse staff.
- Claude Council is installed in Claude Code — suggest it only for big, hard-to-undo decisions.
- ECC plugin: add at Phase 3, not before.
- Run `npm test` before every push.

## Safety notes

- Never paste the API key into any chat. It lives only in `.env.local` (ignored by Git).
- API key expires — check the Anthropic console and replace it before it lapses. Last replaced: 29 Sep 2026.
- Never open `.env.local` while screen-sharing or taking screenshots, and remove it from Claude Code's context if it appears.
- $5 prepaid API credit, auto-reload OFF.

## Starting the app on my laptop

```
cd ~/DocDelay
npm run dev
```

Then open http://localhost:3000.
