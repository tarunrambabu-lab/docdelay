# DocDelay — Backlog

Ideas and known gaps to pick up later.

## To do

- **Before switching the clock to "real" (`CLOCK_MODE` in `src/lib/clock.ts`):** the booking rules ("later today", "5 – Another doctor today", other-day offers) need a "not before now" check. They don't look at the time today; with the fixed demo clock (9:00 AM, the first slot) nothing can be in the past, but with the real time a patient could be offered — and booked into — a slot that has already gone (e.g. 9:30 at 11 AM).
- **"Another doctor" edge case:** if the covering doctor (Dr. Karthik) is later marked unavailable too, patients rebooked to him are affected like anyone else, and the 45-minute rule measures from their original time with Dr. Meera. Check this is what we want.
- **A second "doctor unavailable" window on the same day:** the empty-slot search should avoid it. Right now, if a doctor has two absences in one day, a "later today" patient can be given a slot inside the second absence.
- **Before switching the AI on for the public:** move the site-wide AI message counter to a shared store (e.g. Redis) — on Vercel each server instance has its own memory, so today's in-memory counter isn't a reliable site-wide limit — and set a monthly spend limit for the API key in the Anthropic Console.
- **After Phase 2 (planned, don't build yet): a lighter safety net.** Red-flag phrases set by a clinician → straight to staff. Any other health mention → the 108 line, normal rebooking, and a note. Detecting EVERY health mention still matters under this plan, so the health-check tests stay required.
- **Native-speaker review:** the Tamil and Hindi call wording, text messages, chat replies and the chat keyword lists (`src/lib/understanding/rules.ts`) must be checked by native speakers before real use.

## WhatsApp channel (simulated) — to revisit

Part 1 (data and booking rules, 2 Oct 2026) is done. Still open:

- **After answering, unclear WhatsApp messages never reach staff.** "ok thanks" and anything else DocDelay can't read only gets the patient's booking repeated: it isn't counted, and the "two unclear replies → staff call" rule doesn't apply. Revisit: a patient could be asking for help in words DocDelay doesn't know.
- **Voice notes and photos** come in Part 2. Part 1 only handles typed text.
- **The STOP / not-opted-in health exception is not clinician-checked.** A health mention from a patient who sent STOP, or isn't "WhatsApp OK", gets only the fixed line ("If this is an emergency or you're worried, please call 108…") — no URGENT, no staff note. Revisit in Phase 2 with a clinician.
- **That emergency line is in English only.** No Tamil or Hindi version of this exact line existed, so Tamil and Hindi patients get it in English. Add Tamil and Hindi versions (native-speaker and clinician checked) in `emergencyOnlyReply` (`src/lib/chatReplies.ts`).
- **Native-speaker review list:** the new Tamil/Hindi heads-up for pushed patients (`headsUpSms` in `src/lib/smsText.ts`) and the choices shown after "2" (`changeMenuReply` in `src/lib/chatReplies.ts`).
- **Screens (Part 2):** the call screen should use `getCallQueue`; the Messages page should show each message's channel ("WhatsApp", "SMS", "WhatsApp failed → SMS") — today it lists them all the same way.
- **No "START"** to turn WhatsApp back on after STOP.

## Must do before real calls or laptop demos

These affect the AI chat only (laptop with an API key). The live site uses basic mode and isn't affected.

- **The AI might still claim a booking in wording we haven't listed.** Since 2 Oct, an AI reply that sounds like a confirmation (word list in `src/lib/understanding/aiChat.ts`, `CLAIMS_DONE`) with no booking saved is never shown — basic mode answers instead — and the AI is told never to say it. But wording that isn't on the list would still get through. Extend the list with native speakers, and re-check with the real AI before real calls.

- **"Talk to a person" code check:** if basic mode recognises a request for a person, it wins over the AI. (Found in the AI test run: Tamil "aal kitta pesanum" wasn't understood by the AI and got "please say that again".)
- **Tamil/Hindi "I'll wait" phrases in the AI instructions** (no code override). (Found in the AI test run: Tamil "naan wait panren" got a choice of 3 empty times today instead of the automatic next fair slot, unlike English and Hindi.)
- **"No problem" phrases don't count as avoiding a day** in the AI day check (`dayGuard.ts`): today "No problem, Thursday after 4" skips the check because of the word "no".
- **Optional `npm run test:ai` check** (about $0.10): every suggested phrase in all 3 languages on the real AI path. Run it before laptop demos and real calls.

## Revisit with the real AI

- **"12:15 ku vera doctor kitta book pannunga" in basic mode** re-offers Dr. Karthik's earliest times (9:30, 10:45, 11:30) and ignores the time asked for. It could offer his times at or after that time instead.

- **Offers after "[Day] is full" can include an EARLIER day** (e.g. "Thursday is full" → Tuesday offered). A patient who can only come later in the week might pick one without noticing.
- **"Thursday before 8" doesn't lead with Thursday:** outside-clinic-hours requests on a named day offer the closest slots one per day from that day on, instead of putting the named day first.
- **Fixed Tamil/Hindi month names:** dates come from the server's built-in formatting, which varies by server (e.g. Hindi "अक्तूबर" locally vs "अक्टूबर" on Vercel). Use fixed month-name lists so patients always see the same spelling.
- **Hospital name in local script:** Tamil and Hindi messages still show "Sunrise Multispeciality Hospital" in English letters — store a local-script name (like the doctors' `localNames`) and show it with the English in brackets.
- **Native-speaker check of doctor names and time-of-day boundaries:** the Tamil/Hindi spellings of the doctors' names (`localNames` in mockData.json), and where morning / afternoon / evening / night begin (`formatTimeFor` in src/lib/time.ts — e.g. whether 3:45 PM is மதியம் or மாலை).

## Tooling to add

Claude Code automations suggested by the claude-code-setup plugin (30 Sep 2026).

- ✅ **Done (1 Oct):** test-after-edit hook (`.claude/hooks/test-after-edit.sh` runs `npm test` after Claude edits code in `src/`).
- **Next session:** `/wrap-up` skill — `npm test`, update HANDOFF's "Where things stand", log minor assumptions here, two-group assumptions report, then commit; push only after my OK.
- **Later:** `docdelay-safety-rules` skill that points to HANDOFF.md's "Rules we've agreed" instead of copying the rules (one source of truth).
- **Later:** `safety-reviewer` subagent that checks changes to rescheduling rules, health keywords and AI instructions against the agreed rules — run on demand only, never automatically.
- **Skipped for now:** Playwright MCP (lets Claude click through the app and take screenshots) — revisit when there's more screen work.

## Minor assumptions

Logged from reports (see the rule in CLAUDE.md). Fine for now; revisit if they cause trouble.

- "Morning" requests must end by 12:00 PM and "afternoon" by 4:00 PM — treated like "before X".
- A named day the clinic is closed on (Sunday) gets "The clinic is closed on …" instead of "… is full at that time".
- Staff screens (staff call list, call-simulator header, Buttons screen) stay in English.
- Demo video voice (Indic Parler-TTS): the Tamil and Hindi sample lines are written in Tamil/Hindi script (e.g. "நான் வெயிட் பண்றேன்", "मैं रुक जाऊँगा") rather than English letters, because the model reads native script best.
- Demo video voice: the voice tool runs on the laptop's processor (CPU), not the graphics chip, because CPU is slower but more reliable. Switch to the graphics chip only if CPU is too slow.
- Demo video voice: the voice tool may need Python 3.12 in its own folder if it won't install on the laptop's Python 3.13. (Not needed: it installed on 3.13.)
- Demo video voice: Hindi sample uses the male voice Rohit ("jaunga" is the male form); Tamil uses Jaya (the model page's recommended Tamil voice).
- Demo video voice: narrator is Mary, seed 1, "calm, warm and reassuring … very clear audio" description; the name is spoken as "Dock Delay" (captions say "DocDelay"). Mary is assumed to be a female voice.
- Demo video voiceover: each sentence is made separately (seed 1) and joined with a 0.35 s pause; silence trimmed from sentence ends (50 ms cushion); every scene's loudest point set about 1 dB below full volume.
- Demo video voiceover: the original scene 6 is kept as `scene_6_old.wav`, and the rejected versions are in `voiceover/rejected/`.
- Demo video recording: frames are captured straight from the browser (sharper than Playwright's own video recorder), at 1920×1080 with the page zoomed to 125%.
- Demo video recording: the recording browser only (never the app) adds the zoom, the teal click dot/highlight box, 280 px of extra space at the bottom of each page (so messages can scroll above the captions), and blanks the "Sent …" clock stamps on the Messages page.
- Demo video recording: the "Mark unavailable" pop-up first shows the real clock time, so those few frames are dropped; the video goes straight to 9:00 AM – 12:00 PM.
- Demo video recording: Ganesh Iyer and Gayathri Chandrasekaran answer "1 – Later today" off camera (Buttons mode), so the Hindi and Tamil patients come next in the call order.
- Demo video: each scene's voice starts 0.5 s into the scene; scenes run 1–4 s longer than their voice (total 112 s).
- Demo video captions: one per sentence, split at a comma when longer than 84 characters; white on a dark box, Arial. Audio is mono AAC 192 kbps.
- Claude Code `.env` block: the rule `Read(./.env*)` is in the shared `.claude/settings.json` (committed, so it protects anyone using the repo), not the personal `settings.local.json`. It covers only top-level `.env*` files (the only place one exists) and blocks the file-reading tool, not shell commands like `cat`.
- Claude Code `.env` hook (`.claude/hooks/block-env-read.sh`): blocks any shell command that names a `.env` file (reading or editing), using macOS's built-in `/usr/bin/jq`; if jq is missing or the input can't be read, it blocks the command (fail safe). A command that finds the file without naming it could still slip through.
- Demo video: title and closing cards use the app's light background and teal colour. Rehearsal and build files stay in `~/DocDelay-video/rehearsal/` and `~/DocDelay-video/build/`.
- AI chat: after an outcome (booked / waiting / cancelled / staff / urgent), DocDelay sends its own fixed confirmation line instead of AI-written text, so the AM/PM and local-time-word rules are always met. (It also saves one API call.)
- AI chat: when the daily AI message limit is hit, the simulator switches to Buttons (as before); when the AI errors or its reply fails the checks, only that message falls back to the rule-based stand-in.
- AI chat: in one turn the AI may check slots more than once; all slots offered in that turn are kept (up to 5, A–E). E.g. "kal subah ya parso shaam" also got a day-after-tomorrow morning option.
- AI chat: Tamil/Hindi replies may mix in English words (e.g. "Thursday") around the exact slot text.
- AI chat: the prompt (≈2,300 tokens) is below the minimum size for prompt caching on Haiku 4.5, so each call pays full input price (≈$0.003 per API call).
- ~~AI chat: the "two unclear replies in a row → staff call" rule is followed by the AI from its instructions~~ — now counted by the hms module (see Done).
- Health keywords: I added a few extra words beyond the requested list when unsure (e.g. "exhausted", "racing", "pounding", "clammy", "doctor said", Tamil "sorvu", Hindi "thakan"). Everyday words like "heavy", "pressure", "bhaari" can also escalate non-health messages — accepted, since a false alarm costs one staff call.
- "Couldn't understand" detection has a server-side safety net: AI replies that ask the patient to repeat ("couldn't understand", "say that again", "समझ नहीं", "புரியவில்லை", …) are counted even if the AI didn't call cannot_understand. Other phrasings could slip through, and in theory a normal reply containing those words could be counted.
- When the AI can't understand, DocDelay sends its own fixed "please say it again" line (the same as the rule-based chat), not AI-written text.
- Alarm-fatigue tuning: a short list of harmless phrases is skipped before the health check — tired/exhausted/sick/fed up/bored "of/with/from (the/this) waiting / wait / delay / queue / line / rescheduling"; Hindi "intezaar/wait … thak…"; heavy/bhaari + traffic/rain/work/workload/schedule/jam (and "traffic bhaari"); work/office/job/traffic/schedule/kaam/naukri + pressure/dabav (and "pressure at/from work"). Only those phrases are skipped; the rest of the message is still checked. No Tamil harmless phrases yet.
- "doctor said" removed from the health keywords.
- The harmless phrases are also skipped when the keyword chat works out what the patient wants, so "tired of waiting" is no longer read as "I'll wait" (it's now an unclear reply that asks the patient to choose).
- AI chat: besides the patient's first name, language and original time, the AI is also told the doctor's name, the reason for the delay and the doctor's return time (no patient data).
- Tests: Vitest 4 (not the newest, 5) because 5 needs newer Node type definitions than the project uses. Installed with `--legacy-peer-deps` to get around an npm bug ("Cannot read properties of null (reading 'edgesOut')").
- Tests: `npm test` runs every test once and stops (not "watch" mode). The `@/` imports are set up in `vitest.config.mts` instead of adding the extra `vite-tsconfig-paths` package.
- Health check: the approved Tamil fainting fix covers both word families: "mayakkam" (faint/dizzy, any ending) and "mayangi…" (fainted).
- Health check (word-ending fix): a few extra spellings were added beyond the tested ones — "sirdard" (headache), Tamil-script "thala suthudhu" (colloquial) and the formal "thalai sutru…", "kiru kiru" written with or without a space, and "marathu po…" with or without the doubled "p". The "heavy rain" and "heartfelt" skips also cover their spaced / "nenjar…" spellings.
- Health-check tests: Tamil-script versions of "heartfelt thanks", "heavy rain" and "waiting under the tree" were added (must NOT escalate), plus two messages mixing a harmless word with chest pain (must escalate).
- Demo tour: the "Take the 2-minute tour" button is teal, in the dashboard header before "Messages" and "Reset demo".
- Demo tour: the step number is remembered in the browser tab (sessionStorage), so a refresh continues the tour; if that storage is blocked, it's kept in memory only.
- Demo tour: the card sits along the bottom on phones (at most 45% of the screen, scrolls inside) and bottom-right on laptops; the page gets extra space at the bottom so nothing hides behind it.
- Demo tour: "Next" (steps 3 and 6) only appears once what it explains is on screen; a step can't be completed by an old screen (it must first be seen not done).
- Demo tour: "Take me back" always goes to the dashboard (Dr. Meera Krishnan, today); from there the tour points the way again.
- Demo tour: step 3 points at the appointment list's heading ("Today's appointments · 10 affected"), not the whole list, so the ring fits on a phone screen.
- Offer-pick buttons show the offer's day and time in English format for every language (e.g. "A · Thu 1 Oct, 4:00 PM").
- AI day check: it only looks at the patient's CURRENT message (a weekday named in an earlier message isn't checked).
- AI day check: it's skipped when the message suggests the named day is one to avoid (not / no / except / can't / busy / illa / mudiyadhu / venam / nahi / mat / chhodkar …), so "next week but not Monday" isn't forced onto Monday.
- AI day check: corrections are written to the server log as "[DocDelay AI] day corrected: …".
- AI calendar: each day shows its Tamil and Hindi weekday names in English letters only (the AI reads Tamil/Hindi script on its own).
- Demo chat phrases: the heading reads "Try a reply (demo)"; offer picks show as "A / Pick offer A" and appear first; English phrases have no extra meaning line.
- Demo chat phrases: tapping a phrase doesn't clear anything already typed in the box (only a typed message is cleared after sending).
- Demo chat phrases: the phrase buttons are at least 44 px tall on every screen size (they're new, so no laptop layout changes).
- Phone layout: text boxes (chat box, "Mark doctor unavailable" times) use 16 px text on phones so iPhones don't zoom in when you tap them.
- Phone layout: the "easy to tap" rule (at least 44 px tall below 640 px) lives in one small file, `src/app/tapTarget.ts`, used by every small button and link.
- Phone layout: phone numbers never split across two lines; very long words in chat bubbles and texts wrap instead of widening the page.
- Phone layout: on the dashboard cards, the patient's phone number sits next to their name, and the language badge next to the reason.
- Health-check tests: two messages using the English word "valid" were added to the must-NOT-escalate list, to guard against a future "vali…" word-beginning rule.
- Test-after-edit hook: hides `ANTHROPIC_API_KEY` from the tests as an extra guard (the tests never reach the AI anyway).
- Test-after-edit hook: if `/usr/bin/jq` is missing, it skips the tests with a warning instead of blocking.
- Test-after-edit hook: only files in `src/` trigger it; editing `vitest.config.mts` or `package.json` does not.
- Test-after-edit hook: runs after every single file edit (~4 s), so tests may fail partway through a multi-file change; that's expected.
- Another doctor today: the mock hospital's second cardiologist is Dr. Karthik Raman (`doc-cardio-2`), fictional, with 25 of 32 slots booked today (empty: 9:30, 10:45, 11:30, 1:15, 2:30, 3:45, 4:30) and about 70% booked on other days, with new fictional patients (pat-491 onwards).
- Another doctor today: Dr. Karthik covers for Dr. Meera, but not the other way round (the "can cover for" list is one-way).
- Another doctor today: "approved" = on the doctor's `canCoverFor` list AND the same specialty; the code checks both.
- Another doctor today: the "was → now" line uses full doctor names ("Dr. Meera Krishnan", not "Dr. Meera"), in case two doctors share a first name.
- Another doctor today: "None of these – call me" → Needs staff call, note "Wanted another doctor today".
- Another doctor today: option 5 appears only in the first menu (not on the "no room today" or other-day screens), and only in Buttons mode.
- Another doctor today: if the chosen slot is taken but other slots are left, the patient hears "Sorry, that time was just taken" before the fresh options too (not only when none are left).
- Another doctor today: if staff switch to the Chat tab while a patient is choosing another doctor, the chat shows "only available in Buttons mode" with a link back, and nothing (including the AI) handles that patient in chat.
- Another doctor today: button "5 – Another doctor today" is violet; the status badge "Rebooked – another doctor" is violet too; the call summary counts it as "another doctor".
- Another doctor today: the text message says "your appointment is now with Dr. Karthik Raman (instead of Dr. Meera Krishnan) at …", keeping "Reply 1 to confirm, 2 to change".
- Dashboard: the doctor cards are now 2 across on small screens and 4 across on large ones (were 3), to fit the fourth doctor.
- The "Please choose A, B or C…" sentence now lives in one helper (`pleaseChoose` in callScript.ts), shared by other-day and another-doctor offers; the words are unchanged.
- Demo clock: the setting `CLOCK_MODE` lives in the new `src/lib/clock.ts` (not in `settings.ts`, which holds only chat and AI settings).
- Demo clock: the date is today's REAL date in India in both modes; it still changes at midnight India time.
- Demo clock: the AI daily message limits keep using the real date (they protect real spending).
- Demo clock: stored stamps (steps, call logs, "Sent") stay real; only how they're shown follows the clock. The AI's two stopwatches stay on real time.
- Demo clock: "Mark doctor unavailable" starts at 9:00 AM – 12:00 PM ("until" is still 3 hours after "from"). In real mode it would use India's time, not the visitor's computer time.
- Demo clock: the dashboard label reads "Demo time: 9:00 AM (fixed)" in a small amber badge next to the date, with a tooltip explaining it; English only, like the rest of the staff screens.
- Demo clock: in demo mode, "Sent" times on the Messages page show "9:00 AM" without seconds.
- Demo clock: a test fails if any file other than `clock.ts` reads the computer's clock (the AI stopwatches in `claude.ts` and `aiChat.ts` are allowed).
- Tour step 6 ("Another doctor, same day"): waits for "Next" (shown once the booking is made) instead of moving on by itself, so the "was → now" line can be read.
- Tour step 6: the text says "pick any time"; it doesn't tell the visitor to pick A.
- Tour step 6: if the visitor presses anything other than 5 (1–4, "Didn't pick up", or a chat reply), the ring moves on to the next affected patient; after 2 (or 1 with no room today) it first points at the first other-day time, which books it and shows "Next patient".
- Tour: the Buttons result panel now carries the same "outcome" marker as the chat result, so a Buttons answer during step 4 also counts (the tour still asks for Chat there).
- Tour: the 320 px check used the Playwright installed for the video tool in ~/DocDelay-video (nothing added to the app).
- Tour step 2 fix: the tour card itself doesn't change. During the tour, the "Mark doctor unavailable" pop-up is centred in the space above the card (the tour shares its height as `--tour-card-height`); if there's ever not enough room, the pop-up area scrolls.
- Tour step 2 fix: on screens under 360 px wide (tour or not), the pop-up has slightly less padding and margin, so "09:00 AM" fits in the time boxes. Text stays 16 px so iPhones don't zoom in.
- Browser checks use Playwright from ~/DocDelay-video; WebKit (Safari's engine) is installed in ~/DocDelay-video/.playwright-browsers (299 MB), outside the app repo. The check scripts aren't in the repo.
- Another doctor in chat: "another doctor" is checked after health, talk-to-a-person and cancel, but before offer-picking and "later today" (so "doosra doctor" isn't "option B", and "a different doctor today" isn't "wait").
- Another doctor in chat: "no another doctor" phrases ("I don't want another doctor", "vera doctor venaam", "doosra doctor nahi chahiye", and the same in Tamil/Hindi script) are removed before reading the rest of the message (after the health check). So "…I'll wait" means wait, and "doosra doctor nahi chahiye" is "unclear" (DocDelay asks again) instead of cancelling as before. A bare "no" in front doesn't count ("No, another doctor please" does ask for one).
- Another doctor in chat: typing "5" means another doctor, like "1"–"4" already work.
- Another doctor in chat: after "no other doctor is free today", the patient stays in the conversation (not handed to staff).
- Another doctor in chat: "talk to a person" or "none of these" while looking at Dr. Karthik's times → staff note "Wanted another doctor today".
- Another doctor in chat: one AI turn's offers are never a mix of doctors — the last check wins.
- Another doctor in chat: the AI can book any time that is still free with an approved doctor under the same rules, whether it was offered in the same message or an earlier one (fixed after the real-AI check).
- Another doctor in chat: the suggested-phrase button ("I'd like to see another doctor today"; Tamil "innaikku vera doctor paakanum"; Hindi "aaj doosre doctor se milna hai") shows only when a slot is free. The Tamil and Hindi phrases are NOT yet checked by a native speaker, unlike the other phrases.
- Another doctor in chat: the Chat tab's "only available in Buttons mode" note is gone; a patient who pressed 5 in Buttons can finish in Chat.
- Another doctor in chat: an AI turn uses the demo as it was when the message arrived; like the existing book tool, it doesn't expect changes from another browser tab during that one message.
- Native-speaker review list: add the new Tamil/Hindi "another doctor" words and "no" phrases (`src/lib/understanding/rules.ts`) and the new "no other doctor is free today" line (`src/lib/chatReplies.ts`). The owner isn't sure of the Tamil version of that line: check it first.
- Confirmation check: only "already done" wording counts ("booked", not "book"; "book ho gaya", not "book karna"), plus everyday "done" words in all three languages ("done", "fixed", "all sorted", "see you at"; "fix pannitten", "confirm aachu", "maathitten"; "kar diya", "ho gaya hai aapka"). A false alarm just means basic mode answers that message.
- Confirmation check: if the AI truthfully says "that time was just booked" (by someone else), that message also falls back to basic mode — harmless.
- Confirmation check: each fallback still costs that AI call (the reply was already made).
- Another doctor, AI mode: when basic mode reads a message as "another doctor", basic mode handles THAT message (no AI call, not counted towards the AI limits). The next message (e.g. picking "A") goes to the AI as usual. "No another doctor" phrases still go to the AI.
- WhatsApp data: patients with an odd number (pat-001, pat-003, …) are "WhatsApp OK" (333 of 666); "WhatsApp fails" are pat-007 (Divya Ramasamy, 10:30), pat-009 (Lakshmi Subramanian, 11:30) and pat-013 (Prakash Palanisamy, 12:45), all with Dr. Meera today.
- WhatsApp: the conversation is kept apart from the call chat (`whatsapp` on the appointment), but both share the same offers, so a call can carry on where WhatsApp stopped.
- WhatsApp: DocDelay's first message reuses the call's opening wording (it still says "Press 4…"); WhatsApp-specific wording comes with the screens in Part 2.
- WhatsApp: only appointments DocDelay has contacted (affected or pushed) have a WhatsApp chat; a message about any other appointment is ignored.
- WhatsApp: ignored messages aren't saved at all (nothing in the conversation or the cookie).
- WhatsApp: the channel is written on WhatsApp log lines only; a log line without a channel means "call".
- WhatsApp: a "WhatsApp fails" patient's own incoming messages are still accepted.
- WhatsApp change: while changing, a patient may be offered their own current slot again; picking it isn't counted.
- WhatsApp change: a new answer that isn't finished (offers shown, no pick) is already refused at the 3rd attempt — the staff call is set at the first message of that attempt.
- WhatsApp change: if the new answer finds no free slot at all, or the patient asks for a person, the status becomes "Needs staff call" with the booking left as it is; not counted as a change.
- WhatsApp change: a patient pushed past 5:00 PM who asks to "wait" again is told there's no room today and offered other days (their slot is kept until they pick).
- WhatsApp change: a patient who moved to Dr. Karthik and changes again is treated as Dr. Meera's patient for the new answer (later today / other days are with Dr. Meera; "another doctor" offers Dr. Karthik again).
- WhatsApp: "Needs staff call" and URGENT patients who message get "Our front desk will call you shortly"; nothing changes.
- WhatsApp: a "No answer" patient who sends something unclear gets the "I didn't understand" line and stays "No answer" (not counted towards the staff call).
- WhatsApp updates: "1" keeps meaning "confirmed" until the patient replies "2" or starts a change; the reply to "1" repeats their booking ("Thank you. Your new time is …").
- WhatsApp updates: a WhatsApp update is also added to the patient's WhatsApp conversation.
- Heads-up for pushed patients: "up to N minutes later" is the total delay since their first booked time; a pushed patient who WAS affected (already rebooked, then pushed) still gets the normal "Reply 1 / 2" update.
- Heads-up: a pushed patient's WhatsApp replies are ignored (the message says no reply is needed), except a health mention.

## Done

- ✅ **AI missed "vera doctor paakanum" (found 2 Oct 2026):** basic mode's "another doctor" reading now wins over the AI, the same way the health check runs first.

- ✅ **AI can't show a confirmation it didn't make (2 Oct 2026):** found in the 1 Oct real-AI check ("You're confirmed…" with nothing booked). Such replies are now never shown; basic mode answers that message. Real-AI checks: 1 Oct $0.0907, 2 Oct (Tamil patient) $0.0215.

- ✅ **Tour step 2 on small phones (1 Oct 2026):** the pop-up's "Mark unavailable" button is fully visible and tappable at 320 × 568, 320 × 640, 375 × 667 and 390 × 844, in Chrome's and Safari's engines; "09:00 AM" / "12:00 PM" no longer cut off at 320 px. Screenshots: ~/Desktop/DocDelay-tour-320px/step2-fix.

- ✅ **Fixed demo clock (1 Oct 2026):** 9:00 AM on today's date in India, from `src/lib/clock.ts`; shown on the dashboard, used for "Mark doctor unavailable" and for every time stamp on screen.

- ✅ **"Two unclear replies in a row → Needs staff call – Couldn't understand"** is counted by the hms module for both the rule-based chat and the AI (shared counter).
- ✅ **Wider keyword health check** (tightness, heaviness, uneasy, discomfort, numb, sweating, … plus Tamil/Hindi) — still runs first, before the AI.

- ✅ **No room today → offer "another day" straight away (Stage 5):** when there's no room left today, the call now apologises and offers 3 other-day slots, instead of only saying "our front desk will call you".
- ✅ **Limit how far a patient is pushed (Stage 5):** an unaffected patient is never pushed more than `MAX_PUSH_MINUTES` (45 minutes) past their original booked time. If fitting a "later today" patient would break this, it counts as "no room today" and other days are offered.
