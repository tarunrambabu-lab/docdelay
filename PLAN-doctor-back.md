> **PLAN ONLY — not approved.** Saved word for word from the planning session on 4 Oct 2026. Nothing below has been built.

# Waiting check, step 1: knowing when the doctor is back (plan)

I've read HANDOFF.md, BACKLOG.md and the code this touches: the HMS module, the booking rules, the saved demo steps, the dashboard, the clock and the tour. No app code was written or changed.

## The three things to know first

1. **New bookings after a later time (your point 2) already work for the same doctor.** Every booking rule reads one stored value, the absence's "expected until" time. If "Change expected return time" overwrites that one value, no booking rule needs to change. There is one gap, and it is about the *covering* doctor (Question 4).
2. **An earlier time has two side effects on fairness** that need your decision (Questions 1 and 5).
3. **A later time leaves a real gap until step 2 is built:** patients booked in the extra time are listed for staff but not contacted (Question 3).

## What would be built

**Changed files**
- `src/hms/types.ts`: the absence record gains two optional parts: a list of return-time changes (when, old time, new time) and a "marked available" stamp. The existing "expected until" time stays the one value the booking rules read.
- `src/hms/mockHms.ts`: three new functions: change the expected return time, mark the doctor available, and a read-only list of patients whose times fall inside the absence. No existing booking function changes.
- `src/hms/visitorState.ts`: two new saved demo steps (return time changed; doctor marked available), so a page refresh keeps them. Older saved demos still load.
- `src/app/actions.ts`: two new actions that check the input and call the HMS.
- `src/app/page.tsx`: the banner wording, the history, the system check and the list.
- `README.md`.

**New files**
- `src/lib/returnCheck.ts`: one small function that answers "is the system check due?".
- `src/app/ReturnTimeControls.tsx`: the "Change expected return time" pop-up and the "Mark doctor available" button.
- `src/hms/doctorBack.test.ts` and `src/lib/returnCheck.test.ts`: the new tests.

## 1. Change expected return time

- A "Change expected return time" link in the doctor's red banner opens a small pop-up with one time box. It works at any time until the doctor is marked available, before or after the expected time passes.
- The new time must be later than the absence's start time. Saving the same time does nothing and logs nothing.
- The banner reads: "Dr. Meera Krishnan — away, expected back 2:00 PM (was 12:00 PM)". Under it, a short history: "Expected back changed from 12:00 PM to 2:00 PM", one line per change, with the time it was changed.
- Calls and chats made *after* a change say the new time by themselves, because the opening lines read the same stored value. No wording changes.

**Earlier time.** Nobody already rebooked or pushed is moved. Nothing is sent.

**Later time.** It is recorded and shown. Nobody is contacted. The dashboard shows a read-only list, "Times inside the longer absence — not contacted yet", in these groups (this is the input for designing step 2):

| Group | Who | In the sample data (Dr. Meera, 9–12 changed to 2:00 PM) |
| --- | --- | --- |
| A | Never contacted, booked in the extra time | 6 patients: 12:00, 12:15, 12:45, 1:00, 1:15, 1:30 PM |
| B | Already rebooked by DocDelay into the extra time | Up to 2: the empty slots 12:30 and 1:45 PM are where the first "later today" answers land |
| C | Pushed patients whose new time is in the extra time | Only if a push has happened |
| D | Updates not yet sent that name a time in the extra time | Depends on whether staff pressed "Send updates" |
| E | Patients part-way through choosing, with a "today" offer in the extra time on screen | Their pick is refused (see point 2) |

Not on the list: patients still to be contacted (they are simply offered times from the new return time), and patients who cancelled or moved to another day or another doctor.

## 2. New bookings after a change

Which return time each path reads:

| Path | What it reads | After a later time is entered |
| --- | --- | --- |
| "1 – Later today" / "I'll wait" (Buttons, chat, WhatsApp, AI) | the stored expected time | Works: first slot is at or after the new time |
| A chosen time today ("after 3") in chat, WhatsApp, AI | the stored expected time | Works |
| Booking a picked slot (every path) | re-checks against the stored expected time | Works, and also refuses an offer that was shown *before* the change |
| WhatsApp change of answer | runs the same code on a copy | Works |
| Other days | doesn't use the return time | Not affected |
| "5 – Another doctor today" | the patient's original time only; it never looks at any absence | Dr. Meera's later time doesn't matter here (the slots are Dr. Karthik's). **Gap** if Dr. Karthik himself is away |

**Answer:** it already works for the same doctor. Smallest safe change: none in the booking rules. I would add tests that lock it in (nobody booked at 12:30 once she is back at 2:00, on every path).

Two things to know:
- **The covering-doctor gap (Question 4).** If Dr. Karthik is marked unavailable, Dr. Meera's patients can still be booked into his absence today. This gap exists already and is in BACKLOG. A later return time for him makes it bigger. The smallest fix is one filter in the HMS module: leave out a covering doctor's slots that start inside his own absence.
- **A refused old offer** gets the existing line "Sorry, that time was just taken" and other-day offers in chat and WhatsApp. The time wasn't taken, the doctor is away, so the wording is slightly off. It is safe. This is the same gap already in BACKLOG (3 Oct).

**Side effects of an EARLIER time** (found while checking this):
- New answers are offered times from the earlier return. In the sample data, with the return changed from 12:00 to 11:00, the next "later today" patient gets 11:00 AM, ahead of the patient who answered first and holds 12:30 PM (Question 5).
- When the day is full and the push rule runs, I expect it could move patients DocDelay hasn't reached yet whose original time is after the new return (for example 11:30), and queue an update for them. I will prove this with a test before building anything; what to do depends on Question 1.

## 3. Patients not yet answered: options (not decided)

If the time is made earlier (say 12:00 to 11:00), patients booked at 11:30 and 11:45 could be seen at their own time after all. Options:

- **A. Nothing changes.** They stay red, are still contacted, and choose as usual. Simplest. But they are asked to move for a problem that no longer exists for them.
- **B. Automatic.** Patients DocDelay hasn't reached, whose original time is at or after the new return, go back to "Scheduled" at their own time and leave the call queue. Difficulty: the first WhatsApp message counts as sent the moment the doctor is marked unavailable, so "WhatsApp OK" patients have all been reached. They would need a new "please ignore, your appointment is on" message, which touches the frozen WhatsApp rules and the one-text rule.
- **C. Staff decide.** The dashboard lists them with a "Keep original time" button for each patient. DocDelay moves nobody by itself. Same WhatsApp message question as B.

In every option, patients whose original time is still before the new return stay affected. "Marked available early" has the same options (see Question 2).

## 4. System check

- One small function decides: the check is due when the expected return time has passed and nobody has marked the doctor available. In "real" clock mode it compares with the hospital's time. In "demo" mode the clock is fixed at 9:00 AM, so it never comes up by itself.
- The banner gets a small link: "(Demo) Show the 12:00 PM check". It adds a marker to the dashboard's address. It is not saved, not put in the cookie, and never passed to the HMS, so it cannot change the time used for bookings. `CLOCK_MODE` stays "demo".
- The check is an amber panel: "Dr. Meera Krishnan was expected back at 12:00 PM. Is the doctor back?" with [Mark doctor available] and [Still away: new expected time ___].
- "Still away" uses the same "change expected return time" function, and the new time must be later than the current expected time.

## 5. Mark doctor available

- A button in the banner (any time) and in the system check.
- It records a stamp and ends the absence: the banner reads "Dr. Meera Krishnan — back (marked available)", the system check stops, and "Change expected return time" goes away.
- Nobody is moved, nothing is sent, and no booking rule changes. Patients still to call stay in the call queue until you answer Question 1.

## 6. Tour, README and tests

- **Tour:** no change recommended. It has 10 steps, the most the tour test allows, and runs about 2 minutes. The banner keeps its tour marker, so step 2 still works.
- **README:** one line under "Key features", a short paragraph on the return time and the system check, and one new screenshot of the check. The screenshot run uses the hidden API key (`ANTHROPIC_API_KEY= npx next start …`) and the Chat tab must say "basic mode".
- **Tests (new, about 30):** the change is saved, shown and logged (earlier, later, twice, same time, invalid time); an earlier time moves nobody; a later time moves and messages nobody; no new booking lands inside the longer absence on each path (later today, chosen time, picked offer shown before the change, WhatsApp change, AI wait and book tools); the list groups A–E; the check is due only after the expected time and never after "available"; the demo link changes nothing in the saved demo; "Mark doctor available" moves nobody and blocks further changes; saved steps survive a refresh and old saved demos still load; `CLOCK_MODE` is still "demo". The existing 509 tests must pass unchanged.

## Not changed

The frozen chat and WhatsApp rules, the booking rules file, `CLOCK_MODE`, the one-text rule, and `~/DocDelay-video`. Step 2 will need a second update for some patients, which changes the one-text rule; that is not part of this step.

## Questions before "go"

1. **Patients not yet answered when the time is made earlier (point 3):** A (nothing changes), B (automatic) or C (staff decide)? And what about patients part-way through choosing?
2. **"Mark doctor available" pressed early:** should the booking rules keep offering from the expected time (my recommendation; the nurse changes the expected time first if she wants earlier slots), or should the nurse type the time the doctor came back? The demo clock is fixed at 9:00 AM, so the app cannot know that time by itself.
3. **The gap after a later time:** is it OK for step 1 to go live showing the "not contacted yet" list, with staff calling those patients themselves until step 2? Or keep step 1 off the live site until step 2 is ready? And should "Send updates" warn when an unsent update names a time inside the longer absence?
4. **Covering doctor:** add the one small filter so nobody is booked into Dr. Karthik's absence (my recommendation), or leave it in BACKLOG?
5. **Earlier time and fairness:** is it OK that later answerers can get earlier times than patients who answered first?
6. **"Mark doctor available" by mistake:** add a confirm question ("Is the doctor physically back?") before it is saved? There is no undo in this plan.
7. **Tour:** leave it unchanged (my recommendation), or replace a step?

## Assumptions

**⚠️ Flagged for your decision**

- A later time leaves patients booked in the extra time uncontacted until step 2; they could arrive and wait (Question 3).
- An update not yet sent could tell a patient to come at a time the doctor is now away (Question 3).
- An earlier time lets later answerers get earlier slots than first answerers (Question 5).
- An earlier time may let the push rule move patients DocDelay hasn't reached; to be proven by a test first (Question 1).
- Nobody is protected from being booked into the covering doctor's absence (Question 4).
- "Mark doctor available" has no undo; a wrong press would stop the system check while the doctor is still away (Question 6).
- Marking available early doesn't open earlier slots, which staff may not expect (Question 2).
- A refused old offer says "that time was just taken", which isn't the real reason; staff may be asked about it.
- Patients called before a change heard the old return time; nothing corrects that until step 2.

**Minor, logged in BACKLOG.md**

- "(was 12:00 PM)" shows the time first entered; every change is in the history.
- The check says "Is the doctor back?" instead of "Is she back?", because the data doesn't hold doctors' pronouns.
- History and "marked available" stamps show 9:00 AM in the demo, like every other stamp.
- A new expected time must be later than the absence's start; "Still away" must be later than the current expected time.
- The return time can't be changed after the doctor is marked available.
- The dashboard doesn't refresh by itself to bring up the check; it appears on the next page load (it only matters in "real" clock mode).
- The demo link is a marker in the page address, not saved.
- The staff list is read-only and English only, like other staff screens.
- The three BACKLOG items you named (waiting list, demo video shown time, earlier slots when the doctor is back early) were already there from this morning, so nothing was added.
