# DocDelay — Handoff

Last updated: 4 Oct 2026. Read this first when starting a new chat or a new Claude Code session.

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
| Automated tests (npm test, 555 tests) | Done |
| Tamil/Hindi health-word fix (word beginnings, lookalike guards) | Done, live. Needs a second native-speaker and a clinician review before real patients |
| 7: guided demo tour, suggested chat phrases, phone-width polish | Done, live (29 Sep) |
| AI weekday fix + day check in code | Done. 4 AI items in BACKLOG under "Must do before real calls or laptop demos" |
| Demo video v1 (without the real-call clip) | Done (29 Sep). 1 min 52 s, in `~/DocDelay-video/output/` (video, captions.srt, description.txt). Send-time stamps on the Messages screen were blanked in the recording browser, because it was recorded in the evening |
| Pitch deck for the SRM incubator | Done (30 Sep). Asks for mentorship, introductions to SRM's hospital OPD team, legal and clinical advisers; no funding |
| SRM incubator application | In progress |
| .env Read deny rule + shell hook | Done |
| claude-code-setup plugin | Installed |
| Test-after-edit hook (runs `npm test` after Claude edits `src/`) | Done (1 Oct) |
| "5 – Another doctor today" (FRD 5.4), Buttons + chat (basic and AI mode), with Dr. Karthik Raman as a second cardiologist | Done, live (1 Oct) |
| Fixed demo clock: 9:00 AM on India's date (`CLOCK_MODE` in `src/lib/clock.ts`, kept on "demo") | Done, live (1 Oct) |
| Tour step 6 of 9: "Another doctor, same day" (Buttons, press 5, pick a time with Dr. Karthik) | Done, live (1 Oct) |
| Tour step 2 on small phones: pop-up now sits above the tour card; checked at 4 phone sizes in Chrome and Safari engines | Done, live (1 Oct) |
| README screenshots retaken (4 doctors, demo clock badge, button 5) | Done (1 Oct) |
| Another doctor in chat: suggested-phrase button; basic mode's "another doctor" reading wins over the AI | Done, live (1 Oct) — real-AI checks cost $0.1122 in total |
| Confirmation guard: an AI reply that sounds like a confirmation with nothing booked is never shown | Done, live (1 Oct) |
| WhatsApp Part 1 of 3: rules and data in the HMS module, 403 tests (opt-in, STOP, channel, change of answer, call queue, health check first, WhatsApp/SMS updates, heads-up for pushed patients). Pushed patients can cancel from the heads-up (only after "Reply YES"). No screens yet | Done, live (1 Oct, c9cc9fd) |
| New Tamil and Hindi WhatsApp lines | First native-speaker check done by my mom (2 Oct). Still needs a second native speaker and a clinician before real patients |
| WhatsApp Part 2 of 3: WhatsApp screen at `/whatsapp/<appointment id>` (opened from the patient details panel), tap-list, typing, voice notes and photos (demo), call screen uses getCallQueue; 59 new tests | Done, live (2–3 Oct) |
| Part 2's new Tamil and Hindi lines: "Sorry, I couldn't understand that…" and what "I'm unwell" sends | Checked by my mom (3 Oct), correct |
| REVIEW.md: decisions we're unsure about (10 items, 1 done; latest: WhatsApp "1 – Later today" books straight away — confirm-first idea for Phase 2) | Created (3 Oct), updated (3 Oct) |
| Still to check by my mom | (1) the Tamil/Hindi "stop" words for pushed patients' voice notes (see REVIEW.md); (2) the new first WhatsApp message lines: opening, option 4, option 5, closing line, and the "unexpectedly called away" line (listed in English letters in BACKLOG.md, "Native-speaker review list"). Neither is native-checked yet |
| WhatsApp Part 3 of 3: dashboard labels ("WhatsApp OK", answered by call / on WhatsApp, WhatsApp state incl. "Update sent (WhatsApp)"), "Open WhatsApp" on rows, photo notes, "Needs staff call · holding [time]", WhatsApp chat in the details panel, Messages page channel labels, new first WhatsApp message (hospital, doctor and time only), tour step 7 of 10 (Revathi on WhatsApp), README section and screenshots; 42 new tests; checked at 320/375 px in Chrome and Safari engines | Done, live (3 Oct, f2c78bf). Plan and answers: PLAN-whatsapp-part3.md |
| WhatsApp follow-up: the WhatsApp update always says "due to a schedule change" (SMS unchanged, see REVIEW.md); "Answered…" only when the patient made a choice, otherwise "Last reply by call / on WhatsApp"; "Open WhatsApp" kept on URGENT rows | Done (3 Oct) |
| **WhatsApp: fully done** (Parts 1–3 plus follow-ups; 509 tests) | Done, live (3 Oct) |
| Gap found: a picked slot taken meanwhile (same doctor): Buttons gets no "Sorry, that time was just taken"; chat/WhatsApp re-offer only other days even when today still has room | In BACKLOG.md ("To do"), not built |
| Waiting check | Split into 3 steps, planned in Claude chat (4 Oct). Step 1 is done; step 2 is next, and its plan prompt will come from Claude chat: do NOT plan it in Claude Code until I send it |
| Waiting check, step 1: knowing when the doctor is back | Done (4 Oct), pushed; 555 tests (46 new). Plan and my answers: PLAN-doctor-back.md. In the red banner: "Change expected return time" (shown as "away, expected back 2:00 PM (was 12:00 PM)", every change in the history), "Mark doctor available" (with a confirm question; ends the absence), and "(Demo) Show the [time] check" for the system check "Is the doctor back?" → [Mark doctor available] / [Still away: new expected time]. A LATER time: new bookings start later, and staff see the list "Times inside the longer absence — not contacted yet" (nobody is contacted: that is step 2). An EARLIER time or an early "available": shown and logged only. "Send updates" warns when an unsent update names a time inside the current absence. Nobody is booked with a covering doctor during that doctor's own absence. Checked at 320/375 px in Chrome and Safari engines, API key hidden, basic mode. `CLOCK_MODE` is still "demo"; tour unchanged |
| Waiting check, step 2: the waiting check itself | After step 1. Only for doctors back later than expected. Checked-in patients are asked to keep waiting or come another time ("If you've already seen the doctor, please ignore this message"). Patients not yet arrived whose times now fall inside the longer absence go through the normal DocDelay flow again (a second update is allowed). **Still open:** (1) how to reach checked-in patients: WhatsApp plus a front-desk alert, or a call; (2) when to ask: as soon as the later time is entered, or after they've actually waited 45 minutes |
| Waiting check, step 3: a waiting list | Later. In BACKLOG.md, not built |
| Waiting check, decided (4 Oct) | No staff-approval step before messages. "Seen the doctor" isn't needed while the doctor is away. The only new HMS information needed is "arrived: yes/no" |
| Demo video v2 (4 doctors, demo clock, another doctor, WhatsApp; tour now has 10 steps; no send-time blanking needed) | Next (2nd) |
| Add the video to the README and portfolio | Next (3rd) |
| /wrap-up skill | Next (4th) |
| Phase 2: clinic interviews | After README/portfolio |
| Real calls to my own phone | After the 4 AI backlog items |
| Add the real-call clip to the video | After real calls |

Roadmap position: finishing Phase 1 (Finish MVP). Phase 2 = interview 15+ clinics.

## Rules we've agreed (don't change without asking me)

- The AI only talks; the rules in the HMS module make every booking decision.
- Later today: empty slots first, then push, max 45 minutes for any unaffected patient, nothing after 7 PM.
- A patient's chosen time never pushes anyone; chosen times only up to 5 PM.
- Other days: empty slots only, one offer per day; bookings on other days are never moved.
- Another doctor today (Buttons and chat, basic and AI mode; the rest of the chat rules unchanged): only doctors of the same specialty that the hospital approved to cover; today, empty slots only, at or after the original time, ending by 5 PM; up to 3, earliest first; never pushes their patients; option hidden if none. Slot taken and none left → back to the 1–4 menu with "Sorry, that time was just taken". No fee mention. In chat: the opening adds "Press 5…" only when a slot is free; "no" phrases ("I don't want another doctor", "vera doctor venaam") never ask for one; the AI only offers what its another-doctor tool returns, and the HMS re-checks every booking.
- Bookings never start earlier than the first expected return time; an earlier time or an early 'Mark doctor available' is shown and logged only. (Decided 4 Oct 2026. A LATER expected time does make new bookings start later. In code: `bookingsStartAt` in `src/lib/returnCheck.ts`.)
- Nobody is booked with a covering doctor ("another doctor today") during that doctor's own absence (decided 4 Oct 2026).
- Any health mention → URGENT, straight to staff. The app never judges severity. Escalation gives no booking advantage.
- One text per patient, sent only when staff approve.
- Chat rules are frozen for the MVP; new edge cases go to BACKLOG.md.
- After Phase 2: lighter safety net. Clinician-set red flags → staff welfare check; other health mentions → 108 line, normal rebooking, note for staff/doctor.
- The demo never shows my face or voice. Video: Claude writes the script; Claude Code records automatically and joins video, voice and captions; voice from a free, licence-checked tool (first choice: Indic Parler-TTS).
- Video must say the voices are AI-generated, and must carry this credit (end card or description): "Voices: Indic Parler-TTS by AI4Bharat (Apache 2.0), trained on IndicTTS (IIT Madras), SYSPIN (IISc), Rasa (AI4Bharat) and GLOBE." Voice tool lives in ~/DocDelay-video, never in the app repo.
- Demo clock: fixed at 9:00 AM on today's date in India (`CLOCK_MODE = "demo"` in `src/lib/clock.ts`). Don't switch to "real" until the booking rules have a "not before now" check (BACKLOG).
- Switch the AI off for laptop demos until the 4 backlog AI items are done.
- In chat, basic mode's reading wins over the AI for any health concern (always first) and for "another doctor"; the AI never handles those messages.
- Confirmations only ever use DocDelay's fixed wording: an AI reply that sounds like a confirmation, with no booking saved in that message, is never shown; basic mode answers that message instead. The AI is also told never to say an appointment is booked, moved or confirmed.
- WhatsApp (simulated, alongside calls and texts; rules in `src/hms/mockHms.ts`, "WhatsApp" section):
  - WhatsApp updates always say "due to a schedule change", whatever the reason; the SMS wording is unchanged (decided 3 Oct 2026; SMS question in REVIEW.md).
  - The first WhatsApp message names only the hospital, the doctor and the time: no patient name, no visit reason, and always "unexpectedly called away" whatever the real reason (decided 3 Oct 2026). The call wording is unchanged.
  - Only opted-in ("WhatsApp OK") patients. "STOP" works only when typed (whole message, any case; there is no STOP button) and closes WhatsApp for that appointment. A voice note that says "stop" does NOT close the chat: it goes through the normal voice-note handling (health check first, then understanding) (decided 2 Oct 2026); calls and SMS continue; the one update then goes by SMS.
  - Health check first on every message → URGENT as in chat. Exception (my decision, not clinician-checked): after STOP or if not opted in, a health mention gets only the fixed 108 line — no URGENT, no staff note; everything else from them is ignored.
  - Last finished answer wins (call or WhatsApp): an answered patient can change on WhatsApp; it's a fresh answer under every existing rule; the old booking stays until the new answer is finished, then it's freed; pushed patients stay put. At most 2 changes; a 3rd attempt → "Needs staff call – Keeps changing", nothing changes. Picking the same slot isn't a change. "Needs staff call" and URGENT can't be changed by WhatsApp.
  - Calls skip anyone who answered; a patient part-way through a WhatsApp reply goes to the end of the call queue.
  - Updates: still one per patient, staff-approved, only when staff press "Send updates": WhatsApp if opted in, SMS if "WhatsApp fails" (labelled) or not opted in — never both. After an update, "1" = confirmed (no change), "2" = show the choices (not counted until they pick). Changing to "cancel" drops an unsent update.
  - Pushed (not affected) patients get a heads-up instead of the update: "…may start up to N minutes later, around [time]. Reply 1 if that's fine, 2 to cancel, 3 to talk to a person." Replies are read against the heads-up, never the main menu: 1 / "ok" = nothing changes; 2 / cancel wording = "Reply YES to cancel", cancelled only on YES (slot freed, nobody moves back); "don't cancel" never cancels; 3, another day or anything else = "Needs staff call – Replied to heads-up", booking kept.
  - The 108-only line is in the patient's language (Tamil and Hindi: first native-speaker check done 2 Oct; second native speaker and clinician still needed).
  - Voice notes are understood (turned into text, same checks as a typed message, 108-only exception after STOP). An unclear one gets "Sorry, I couldn't understand that. Please type your answer or tap an option. If this is an emergency, call 108."
  - Photos are not read and never health-checked (accepted for the MVP, 2 Oct 2026; clinician question in BACKLOG). The patient gets the same "Sorry…" line and staff get a line in the log. A photo counts towards "two unclear replies", only before the patient has answered, and never creates an URGENT alert.
  - A pushed patient's voice note that says "stop" (English, or the Tamil/Hindi words in `src/hms/mockHms.ts`) and nothing else DocDelay can read: only the "Sorry…" line, booking kept, no staff call; an open "Reply YES to cancel" stays open (a later YES cancels). Health phrases and clear wording ("can't come", "cancel") in it are read as usual. "ruko" isn't a stop word (it's read as "I'll wait").
  - Anything DocDelay couldn't understand (typed, voice note or photo) never moves a patient to the end of the call queue; only a reply DocDelay understood does.
  - The tap-list on the WhatsApp screen depends on where the patient is (menu, A/B/C, "1 Keep it / 2 Change", heads-up "1 / 2 / 3", "YES / No"), because "1" means different things at different moments.
  - WhatsApp uses basic mode only, never the AI.
- Decisions we're unsure about go in REVIEW.md; new ideas go in BACKLOG.md.
- WhatsApp rules (FRD 6.1) are frozen for the MVP (1 Oct 2026). Parts 2 and 3 only build screens; new ideas go to BACKLOG.md.
- Any browser test or local test server Claude runs must have the API key hidden, so it can never spend credit. Start the server with the key set to empty: `ANTHROPIC_API_KEY= npx next start …`. (Just removing the variable isn't enough: Next.js then reads the key from `.env.local` by itself.) Before testing, check the Chat tab says "basic mode", not "AI". (`npm test` never reaches the AI, and the test-after-edit hook hides the key too.)

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
