# DocDelay — Handoff

Last updated: 1 Oct 2026. Read this first when starting a new chat or a new Claude Code session.

## What DocDelay is

An add-on for hospital systems that reschedules a doctor's patients when the doctor is suddenly unavailable (e.g. pulled into emergency surgery). It finds every affected patient, contacts them in English, Tamil or Hindi, and rebooks them fairly for later today or another day, or cancels.

## Key links

| What | Link |
| --- | --- |
| Live demo | https://docdelay-three.vercel.app |
| Code (GitHub) | https://github.com/tarunrambabu-lab/docdelay |
| FRD (every feature, rule, decision) | https://claude.ai/code/artifact/7d6ed743-f25b-42d4-81f4-da28c38083f9 |
| Roadmap to a saleable product | https://claude.ai/code/artifact/b597391c-b2a0-4666-b917-5bcf1858e021 |
| Demo video script | https://claude.ai/code/artifact/62726fe5-7d52-4823-a167-cbe4292f4242 |
| Pitch deck (SRM incubator, 13 slides) | https://claude.ai/artifact/KgN538gVRAGqP1oQfMGv7Y |

## Where things stand

| Stage | Status |
| --- | --- |
| 1–5: dashboard, doctor unavailable, simulated calls (3 languages), fair rescheduling, one text per patient | Done |
| Live site on Vercel, GitHub README, screenshots, copyright notice | Done |
| 6: chat mode | Done. Live site = basic word-list chat. Laptop = real AI (Claude Haiku 4.5) using my API key in `.env.local` |
| Safety: wide health-keyword check runs first; "two unclear replies" counted in code | Done |
| Alarm-fatigue fix ("tired of waiting", "heavy traffic", "work pressure", remove "doctor said") | Done |
| Automated tests (npm test, 273 tests) | Done |
| Tamil/Hindi health-word fix (word beginnings, lookalike guards) | Done, live. Needs a second native-speaker and a clinician review before real patients |
| 7: guided demo tour, suggested chat phrases, phone-width polish | Done, live (29 Sep) |
| AI weekday fix + day check in code | Done. 4 AI items in BACKLOG under "Must do before real calls or laptop demos" |
| Demo video v1 (without the real-call clip) | Done (29 Sep). 1 min 52 s, in `~/DocDelay-video/output/` (video, captions.srt, description.txt). Send-time stamps on the Messages screen were blanked in the recording browser, because it was recorded in the evening |
| Pitch deck for the SRM incubator | Done (30 Sep). Asks for mentorship, introductions to SRM's hospital OPD team, legal and clinical advisers; no funding |
| SRM incubator application | In progress |
| .env Read deny rule + shell hook | Done |
| claude-code-setup plugin | Installed |
| Test-after-edit hook (runs `npm test` after Claude edits `src/`) | Done (1 Oct) |
| /wrap-up skill | Next |
| "5 – Another doctor today" (Buttons only, FRD 5.4), with Dr. Karthik Raman as a second cardiologist | Done (1 Oct) |
| Fixed demo clock: 9:00 AM on India's date (`CLOCK_MODE` in `src/lib/clock.ts`, kept on "demo") | Done (1 Oct) |
| Optional: rebuild the video without the send-time blanking (not needed any more: "Sent" times now show the demo time, 9:00 AM) | Next (optional) |
| Add the video to the README and portfolio | Next |
| Phase 2: clinic interviews | After README/portfolio |
| Real calls to my own phone | After the 4 AI backlog items |
| Add the real-call clip to the video | After real calls |

Roadmap position: finishing Phase 1 (Finish MVP). Phase 2 = interview 15+ clinics.

## Rules we've agreed (don't change without asking me)

- The AI only talks; the rules in the HMS module make every booking decision.
- Later today: empty slots first, then push, max 45 minutes for any unaffected patient, nothing after 7 PM.
- A patient's chosen time never pushes anyone; chosen times only up to 5 PM.
- Other days: empty slots only, one offer per day; bookings on other days are never moved.
- Another doctor today (Buttons only; chat unchanged): only doctors of the same specialty that the hospital approved to cover; today, empty slots only, at or after the original time, ending by 5 PM; up to 3, earliest first; never pushes their patients; option hidden if none. Slot taken and none left → back to the 1–4 menu with "Sorry, that time was just taken". No fee mention.
- Any health mention → URGENT, straight to staff. The app never judges severity. Escalation gives no booking advantage.
- One text per patient, sent only when staff approve.
- Chat rules are frozen for the MVP; new edge cases go to BACKLOG.md.
- After Phase 2: lighter safety net. Clinician-set red flags → staff welfare check; other health mentions → 108 line, normal rebooking, note for staff/doctor.
- The demo never shows my face or voice. Video: Claude writes the script; Claude Code records automatically and joins video, voice and captions; voice from a free, licence-checked tool (first choice: Indic Parler-TTS).
- Video must say the voices are AI-generated, and must carry this credit (end card or description): "Voices: Indic Parler-TTS by AI4Bharat (Apache 2.0), trained on IndicTTS (IIT Madras), SYSPIN (IISc), Rasa (AI4Bharat) and GLOBE." Voice tool lives in ~/DocDelay-video, never in the app repo.
- Demo clock: fixed at 9:00 AM on today's date in India (`CLOCK_MODE = "demo"` in `src/lib/clock.ts`). Don't switch to "real" until the booking rules have a "not before now" check (BACKLOG).
- Switch the AI off for laptop demos until the 4 backlog AI items are done.

## How I like to work

- Explain things simply, step by step.
- Assumptions are fine, but flag any that could risk patient safety, book the wrong slot or move someone unfairly, or confuse staff.
- Claude Council is installed in Claude Code — suggest it only for big, hard-to-undo decisions.
- ECC plugin: add at Phase 3, not before.
- Run `npm test` before every push.
- Not using claude-mem or Headroom for now (decided 30 Sep).
- Looking for a mentor, not a co-founder.

## Safety notes

- Never paste the API key into any chat. It lives only in `.env.local` (ignored by Git).
- API key expires — check the Anthropic console and replace it before it lapses. Last replaced: 29 Sep 2026.
- Never open `.env.local` while screen-sharing or taking screenshots, and remove it from Claude Code's context if it appears.
- $5 prepaid API credit, auto-reload OFF.
- Claude Code is blocked from reading .env files (a Read deny rule plus a shell hook). The hook also blocks harmless commands that mention .env; that's expected.

## Starting the app on my laptop

```
cd ~/DocDelay
npm run dev
```

Then open http://localhost:3000.

To test on my phone (same Wi-Fi): `npm run build`, then `npx next start -H 0.0.0.0`, then open the laptop's Network address on the phone.

## Rebuilding the demo video

Everything lives in `~/DocDelay-video` (never in this repo). It records the LIVE site, so push and deploy any app change first.

```
cd ~/DocDelay-video
.venv/bin/python build/record.py     # clicks through the live site, ~2.5 min
.venv/bin/python build/assemble.py   # joins picture, voice, captions, ~1 min
```

Output: `~/DocDelay-video/output/DocDelay_demo_v1.mp4` and `captions.srt`.
- Voiceover: `voiceover/scene_1.wav` … `scene_8.wav` (Mary, seed 1; spoken as "Dock Delay"). Remake with `.venv/bin/python make_voiceover.py` (~11 min).
- Scene timings, clicks and the title/closing cards: `build/record.py`, `build/title.html`, `build/closing.html`. Captions: `build/assemble.py`.
- To drop the send-time blanking, delete the "Messages page: hide only the real Sent … clock stamps" rule in `build/overlay.js`. Since the demo clock (1 Oct), "Sent" times always show 9:00 AM, so it can go at any time of day.
