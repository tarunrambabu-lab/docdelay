# DocDelay — Project Rules

## What this app is
Doctors sometimes get pulled into emergency surgery, and their booked patients get stuck waiting. DocDelay plugs into a hospital's system (HMS), finds the affected appointments, and contacts each patient to ask whether they want to wait for a later slot today, reschedule to another day, or cancel.

## Current phase: MVP (no real phone calls yet)
- Use a FAKE (mock) hospital system with realistic sample data.
- Phone calls are SIMULATED in the browser.
- Keep the HMS connection behind one clean module so a real HMS (FHIR or custom API) can replace the mock later.

## Tech
- Next.js + TypeScript + Tailwind CSS
- Store data locally (a JSON file or SQLite). No cloud services yet.

## How to work
- The owner is a beginner. Keep code simple and well-commented.
- Build in small steps. After each step, explain in plain English what changed and how to run it.
- Never add features that weren't asked for.
- You may make reasonable assumptions to keep moving. At the end of every report, list ALL the assumptions you made, in two groups:
  - **⚠️ Flagged for your decision** — only assumptions that could (a) put patient safety at risk, (b) book the wrong slot or move someone unfairly, or (c) confuse staff about what to do. Explain the risk in one line each, so I can decide.
  - **Minor, logged in BACKLOG.md** — everything else. Also add these to BACKLOG.md (under "Minor assumptions").
- Read HANDOFF.md at the start of every session, and update its 'Where things stand' table at the end of each session.

## Next.js notes
@AGENTS.md
