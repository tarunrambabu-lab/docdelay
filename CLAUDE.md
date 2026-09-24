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

## Next.js notes
@AGENTS.md
