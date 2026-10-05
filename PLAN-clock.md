> **PLAN ONLY — not approved.** Saved word for word from the planning session on 6 Oct 2026. Nothing below has been built.

# The clock fix: "not before now" check and a demo time picker (plan)

I've read HANDOFF.md, BACKLOG.md, PLAN-waiting-check.md and the code this touches: the clock, the booking rules, the HMS module, the saved demo steps, the dashboard, the AI instructions, the tour and the tests. I also looked (read-only) at the recording scripts in `~/DocDelay-video`. No app code was written or changed.

## What the plan does, in short

1. **One "time now" for each visitor's demo.** It starts at 9:00 AM. The visitor can move it with a small picker on the dashboard. It is saved in that visitor's own demo, like every other step.
2. **No booking path can offer or book a time today that has already passed.** All same-doctor paths already read one value for "when bookings start". That value becomes the latest of: the first expected return time, the current expected return time, and now (rounded up to the next quarter hour). "Another doctor today" gets the same filter.
3. **`CLOCK_MODE` stays "demo".** "real" mode would use the real time with the same check, but this plan does not switch it on.

## How "now" works (the one tricky part)

Each visitor's demo is rebuilt from their saved steps on every page load. So "now" can't be a single fixed value any more: a booking made when the demo time was 10:00 must be rebuilt as it was at 10:00, even after the visitor moves the time to 1:00 PM.

- Changing the demo time becomes a saved step ("demo time set to 1:00 PM").
- While the demo is rebuilt, each step uses the demo time that was set at that point.
- In "real" mode, each step would use the real hospital time of the moment it happened (already stored with every step).
- "Reset demo" clears the steps, so the time goes back to 9:00 AM.

**Stamps on screen.** Today every stamp (call log, history, "Sent") shows "9:00 AM". With the picker they would show the demo time at which each thing happened: a call made at demo time 1:00 PM shows "1:00 PM". The real stamp is still stored underneath to keep steps unique and in order.

## 1. "Not before now" check

**The rule:** a slot today may be offered or booked only if it starts at or after now, rounded up to the next quarter hour (10:07 → 10:15; exactly 10:00 → 10:00). Other days are not affected.

| Path | How it gets the check |
| --- | --- |
| "1 – Later today", empty slot (Buttons, chat, WhatsApp, AI "wait" tool) | Reads the one "bookings start at" value, which now includes "now" |
| "1 – Later today", push | Same value. The push only moves patients from that time on, so nobody whose time has passed is ever moved |
| A chosen time today ("after 3") in chat, WhatsApp, AI "check free slots" | Same value |
| Booking a picked slot (Buttons offers, chat, WhatsApp, AI "book" tool) | The booking re-check uses the same value, so an offer shown earlier is refused once its time has passed |
| WhatsApp change of answer | Runs the same code on a copy, so it is covered |
| "5 – Another doctor today" (Buttons, chat, AI tools) | Today it searches from the patient's original time. It becomes the later of that time and now. The booking re-check does the same |
| "Keep waiting" (planned, step 2) | It is the "later today" rule, so it is covered |
| Other days | No change |

**Two different times, kept apart on purpose:**
- **When bookings start:** includes "now". Used only to find and check slots.
- **When the doctor is back:** does not include "now". Used for what patients are told ("The doctor expects to be back around 12:00 PM"), for the refused-offer line ("Dr. … will now be back at 2:00 PM"), and for the covering-doctor rule. Otherwise a patient at 1:07 PM would be told "the doctor is back at 1:15 PM", which isn't true.

**What a patient hears in the new cases** (existing wording wherever possible):
- "Today after 2" asked at 3:00 PM: offers from 3:00 PM, with no extra sentence.
- "Today before 11" asked at noon: the existing "Nothing is free today at that time" line, then other days.
- Nothing left today at all: the existing "no room today" flow, then other days.
- Picking an offer whose time has passed since it was shown: see Question 5.

**The AI** is told one new fact: "Time now at the hospital: [time]". Its instructions get one line: never offer or mention a time today before that. The tools enforce the rule anyway, so a wrong AI reply still can't book a passed time. The time now is added to the times the AI's reply may mention.

## 2. Demo time picker

- Replaces the yellow "Demo time: 9:00 AM (fixed)" badge with "Demo time: [9:00 AM ▾]", in 15-minute steps from 9:00 AM to 5:00 PM (33 choices).
- Demo mode only. In "real" mode the badge reads "Time now: 3:47 PM (India)" as it would today, with no picker.
- Choosing a time saves it at once and reloads the dashboard.
- Each visitor's own demo only (it is in their saved steps). "Reset demo" sets it back to 9:00 AM. Starting the tour resets the demo, so the tour always starts at 9:00 AM.
- Changing the time several times in a row keeps only the last one, so the saved demo doesn't fill up.
- Changing the time moves nobody and sends nothing. It only changes what is offered from then on, and what the screens show.

## Your questions: options (not decided)

**Can the demo time go backwards?**
- A. Forward only: earlier times are greyed out in the picker; "Reset demo" is the way back. Simplest, and nothing can end up "booked in the past". My recommendation.
- B. Backwards allowed: handy while exploring, but a booking made at 1:00 PM stays while the clock says 10:00 AM, logs run out of order, and step 2's "probably in the hospital" could be judged twice with different answers.

**Patients whose time has passed, on the dashboard:**
- A. Nothing.
- B. A small grey "Time passed" label next to the time, on today's rows only. No status changes. It makes the time picker's effect visible, and shows who step 2 will treat as "probably in the hospital". My recommendation.
- C. Grey out the whole row. I'd avoid this: a red "needs contact" patient whose time has passed still needs contact and must stay obvious.

**The step 1 "Is the doctor back?" check:**
With the picker it comes up by itself once the demo time reaches the expected return time. The "(Demo) Show the check" link is then not needed. Options: remove the link (my recommendation), or keep both.

**"Mark doctor unavailable", the "from" time:**
It already starts at "the clock's time now, rounded up"; with the fixed clock that was always 9:00 AM. With the picker it would follow the demo time by itself (at 1:00 PM: 1:00 PM – 4:00 PM). The tour keeps 9:00 AM – 12:00 PM. Options: follow the demo time (my recommendation), or always start at 9:00 AM. Either way staff can still type an earlier "from" (the doctor left 20 minutes ago).

## Which existing rules change (time filter only)

**Booking rules (HANDOFF, "Rules we've agreed"):**

| Rule today | With the clock fix |
| --- | --- |
| Later today: empty slots first, then push, from the doctor's return | …from the doctor's return or now, whichever is later |
| A chosen time: only empty slots, up to 5 PM | …and never before now |
| Another doctor today: at or after the original time | …and never before now |
| Bookings never start earlier than the first expected return time | …nor earlier than now |
| Nobody is booked with a covering doctor during that doctor's own absence | Unchanged |
| Max 45 minutes for an unaffected patient; nothing after 7 PM | Unchanged |
| Other days: empty slots only, one offer per day | Unchanged |
| Demo clock: fixed at 9:00 AM; don't switch to "real" until the "not before now" check exists | The demo time starts at 9:00 AM and the visitor can move it. The check now exists, but "real" still stays off (see "Not in this plan") |

**Frozen chat rules:**
- Offers for today start from now.
- A wish that is wholly in the past today ("before 11" at noon) gets the existing "nothing free today at that time" line.
- A picked offer whose time has passed is refused (Question 5 for the wording).
- The AI is told the time now, with one new instruction line.
- Nothing else: the keyword file, the health check, "two unclear replies", and the order of checks are untouched.

**Frozen WhatsApp rules (FRD 6.1):**
- "1 – Later today", chosen times and changes of answer: the same time filter.
- A picked offer whose time has passed is refused (Question 5).
- Message times in the chat show the demo time when each was sent, not always 9:00 AM.
- Nothing else: opt-in, STOP, the heads-up, "1 = confirmed", the 2 changes, the call queue and the update rules are untouched.

**Smaller agreed things that change:**
- "Stored stamps are shown as 9:00 AM in the demo" becomes "shown as the demo time when they happened".
- The dashboard badge "(fixed)" goes.
- Step 1's demo-only link (if you choose to remove it).

## Tour, README, tests and the demo video

- **Tour:** no step changes. Starting the tour resets the demo, so it starts at 9:00 AM. I'd switch the picker off while the tour is running, so a visitor can't break a step by moving the time (Question 6).
- **README:** the "Demo clock" feature line and the dashboard screenshot (the badge becomes a picker). One line in "Product decisions".
- **Tests that must change (they say "always 9:00 AM"):** the clock tests (3), the "Mark doctor unavailable" defaults tests, the WhatsApp screen test "every message time is the demo clock's 9:00 AM", and, if the demo link goes, its 2 tests. They would be rewritten to "9:00 AM until the visitor changes it". Every other existing test must pass unchanged, because without a time change everything still happens at 9:00 AM.
- **New tests (about 50):** each path in the table above at a later demo time (nothing offered or booked before now; rounding up; exactly-on-the-quarter allowed); the push never moves a passed patient; another doctor from the later of original time and now; other days unchanged; what patients are told still names the doctor's return, not "now"; the refused-offer line still names the doctor's return; a passed offer is refused; the AI is told the time and its tools refuse passed times; the time step is saved, survives a refresh and is cleared by "Reset demo"; rebuilding the demo gives the same result after the time is moved; stamps show the demo time they happened at; the system check comes up by itself; the picker's 33 choices; `CLOCK_MODE` is still "demo"; no other file reads the computer's clock.
- **Demo video (`~/DocDelay-video`, not changed):** the recording clicks through the live site from a fresh demo, so it still runs at 9:00 AM and the flows don't change. Two things to know: the dashboard will show the picker instead of the "(fixed)" badge, so v1's pictures will differ from the live site; and the recording script has a rule that blanks "Sent" stamps and a pause for the pop-up's first frames, both written for the old real-time clock, which were already no longer needed. Video v2 can use the picker to show the system check with no trick.
- **Browser checks:** the picker and any "Time passed" label at 320 and 375 px, API key hidden (`ANTHROPIC_API_KEY= npx next start …`), Chat tab on "basic mode".

## Not in this plan

- Switching `CLOCK_MODE` to "real". Besides this check, real time still needs: the dashboard refreshing by itself, the real 15-minute wait before the SMS fallback, and a decision on what a saved demo means the next day. These stay in BACKLOG.
- Waiting check step 2. After this is built, PLAN-waiting-check.md is re-checked against it.
- `~/DocDelay-video`.

## Questions before "go"

1. **Backwards:** forward only with "Reset demo" as the way back (my recommendation), or allow backwards?
2. **Time passed:** nothing, a small grey "Time passed" label (my recommendation), or something else?
3. **System check:** remove the "(Demo) Show the check" link now that the check comes up by itself (my recommendation)?
4. **"Mark doctor unavailable":** "from" follows the demo time (my recommendation), or always 9:00 AM?
5. **A picked offer whose time has passed:** today's line would be "Sorry, that time was just taken", which isn't true. Add one new fixed line, "Sorry, that time has already passed.", in English, Tamil and Hindi (needs a native check, and is one more narrow exception to the frozen rules)? Or reuse "just taken"?
6. **Tour:** switch the picker off while the tour runs (my recommendation), or leave it on?
7. **A slot starting exactly now** (10:00 at 10:00) can still be booked. OK, or should the patient need some notice (for example, the next slot)?
8. **Stamps:** OK that logs and "Sent" times show the demo time at which they happened, instead of always 9:00 AM?
9. **The AI:** adding the time now changes its instructions, which have only been checked against the real AI in their current form. OK to change them now and re-check with the real AI later (about $0.10), keeping the AI off for laptop demos as agreed?

## Assumptions

**⚠️ Flagged for your decision**

- Patients are told the doctor's return time, not "now", so a patient at 1:07 PM can hear "back around 12:00 PM" and then be offered 1:15 PM. I think this is the honest wording, but staff may be asked about it.
- A slot that starts exactly now can be booked, with no travel time (Question 7).
- A patient who has no WhatsApp and whose offer's time passes before they are called again hears a "sorry" line that may be wrong until Question 5 is settled.
- Late in the day there may be nothing left today, so more patients are offered other days; at 5:00 PM "later today" can only work through the push rule (up to 7 PM), as it does today for a 5:00 PM return.
- "Mark doctor unavailable" can still be given a "from" time in the past, which turns red some patients whose time has already passed. They are contacted like anyone else.
- Moving the demo time moves nobody and sends nothing, even for patients whose booked time is now in the past.
- The AI's new instruction line is not checked against the real AI in this step (Question 9).

**Minor, logged in BACKLOG.md**

- The time now is kept in each visitor's saved steps; several time changes in a row keep only the last.
- Rounding is up to the next quarter hour; a time exactly on the quarter stays.
- The picker is a drop-down list that saves on change, with no separate "Save" button.
- The picker runs from 9:00 AM to 5:00 PM only.
- The time now is added to the times the AI's reply may mention.
- In "real" mode each step would use the hospital time of the moment it happened; not switched on.
- The dashboard date is still today's real date in India in both modes.
- The AI's daily message limits keep using the real date and time.
