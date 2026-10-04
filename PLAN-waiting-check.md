> **PLAN ONLY — not approved.** First saved word for word from the planning session on 4 Oct 2026, then updated the same day with the founder's answers (they are at the end, "Founder's answers"). Nothing below has been built.
>
> **Not buildable yet.** Point 1 ("probably in the hospital") needs time to pass, which the fixed demo clock can't show. Step 2 will be built AFTER the clock fix (the "not before now" check plus a demo time picker), and this plan must be re-checked against that fix first.

# Waiting check, step 2 (option A): plan

I've read HANDOFF.md, BACKLOG.md, REVIEW.md, PLAN-doctor-back.md and the code this touches: the HMS module, the WhatsApp rules, the heads-up reader, the saved demo steps, the dashboard, the staff call list and the Messages page. No code was written for this part.

## What happens, in one picture

Staff enter a later return time (12:00 → 2:00 PM). At that moment, for every patient of that doctor whose time today is now inside the absence:

| Patient | What happens |
| --- | --- |
| **Probably in the hospital** (their booked time has already passed), would wait more than 45 minutes past their booked time, fewer than 2 "doctor is late" contacts so far | Asked the waiting check on WhatsApp (if "WhatsApp OK"), and always put on a front-desk alert. No phone call. |
| **Probably in the hospital**, would wait 45 minutes or less | Nothing. |
| **Everyone else** (booked time not yet passed), fewer than 2 contacts so far | Turns red ("Affected – needs contact") and goes through the normal flow, including phone calls. |
| Already had 2 contacts | No message. "Needs staff call – Doctor delayed again", booking kept, plus a front-desk alert if they're probably in the hospital. |
| With staff already (Needs staff call, No answer, URGENT), cancelled, or moved to another day | Nothing changes. |

"Later" means the time bookings start at has moved later (12:00 → 2:00). An earlier time, or 10:00 → 11:00 when the first time was 12:00, triggers nothing.

## The counter: at most 2 "doctor is late" contacts

- One shared counter per appointment. It counts every time DocDelay contacts the patient because the doctor is late: the first absence, each later return time that catches their time, and each waiting-room question.
- "Come another time" and the choices that follow belong to the same contact; they don't add one.
- A push (the heads-up) doesn't count.
- On a 3rd: no message. The patient becomes "Needs staff call – Doctor delayed again", plus a front-desk alert if they're probably in the hospital.
- The counter covers today's appointment only. Moving to another day resets it to 0 for the new appointment. Moving to another doctor today keeps the count.
- What follows from this: a patient from the first absence already has 1 contact, so they can be contacted about a later time only once more. A patient who was never contacted can be contacted twice.

## 1. "Probably in the hospital"

- There is no check-in tracking: no "arrived: yes/no" mark and no "Mark checked in" button. The HMS is asked for nothing new.
- A patient counts as "probably in the hospital" if their booked time has already passed at the moment the later return time is saved. Everyone else gets the normal flow.
- It is worked out once, when the later time is saved; it is not stored as a fact about the patient.
- This needs the app to know the time now, so it depends on the clock fix (see the note at the top).
- Known gap, accepted for now: a patient who is counted as in the hospital but is actually late just gets the WhatsApp message. If they have no WhatsApp, they get no contact (BACKLOG: must be solved before real patients).

## 2. When to ask

As soon as a later return time is saved, from "Change expected return time" or "Still away" in the system check. No moving clock; `CLOCK_MODE` stays "demo". There is no staff-approval step for the waiting-check message.

The safeguard against a mistyped time: before anything is saved, the pop-up asks "Are you sure?" with a summary: "This will message X patients in the waiting room, alert the front desk about Y, and turn Z red." Nothing happens until staff confirm. If nobody is caught by the new time, it saves as it does today.

## 3. Who is asked

Patients who are probably in the hospital, with this doctor today, whose current booked time is inside the absence, and where the new return time is more than 45 minutes after that booked time. Example with a return at 2:00 PM: booked 12:00, 12:15, 12:45, 1:00 → asked; booked 1:15 (exactly 45 minutes) or 1:30 → nothing.

- The "booked time" is the patient's current time, the one they were last told.
- This includes patients probably in the hospital who are still red from the first absence and haven't answered. From then on they get the front-desk alert plus WhatsApp, and are taken out of the call queue (no phone call).

## 4. How

- **WhatsApp** for "WhatsApp OK" patients who haven't sent STOP.
- **A front-desk alert for every patient asked**, WhatsApp or not: a new panel on the dashboard, "Patients probably in the waiting area", and the same rows in the staff call list. Each row shows the patient, their booked time, and where they stand ("No answer yet", "Keeps waiting – new time 2:15 PM", "Choosing another time", "Doctor delayed again").
- For patients without WhatsApp, the alert is the only channel. Staff ask them in person and press [Keeps waiting] or [Wants another time].
- No phone call: patients who were asked are left out of the call queue.

## 5. The message

"[Hospital]: The doctor will be later than expected. Would you like to keep waiting, or come another time? If you've already seen the doctor, please ignore this message. Reply 1 to keep waiting, 2 to come another time."

No reason, no patient name, no doctor name. The WhatsApp tap-list shows "1 – Keep waiting / 2 – Come another time" while the question is open.

## 6. Replies

- **Health check first**, as on every WhatsApp message. A health mention → URGENT, and the alert says "may be in the waiting area", so staff look there first.
- **"1" / "I'll wait" → Keep waiting.** DocDelay books the next fair slot today from the new return time, exactly like "1 – Later today": an empty slot first, then a push within the 45-minute limit, nothing past 7 PM. The reply is the existing fixed line: "Thank you. Your new time is [time] today." If there is no room today, other days are offered, as today. The patient is noted as "kept waiting" for the step 3 waiting list.
- **"2" / "another time" → the existing choices** (later today, another day, another doctor, cancel, talk to a person), under the existing fair rules. On WhatsApp they answer there in basic mode; without WhatsApp, staff use the existing Buttons screen at the desk. This is part of the same contact.
- **Anything unclear:** the existing "Sorry, I couldn't understand that…" line. The patient is on the front-desk alert anyway.
- **No reply:** nothing happens; the alert stays "No answer yet".
- At the desk, [Keeps waiting] does the same booking and shows the new time for staff to tell the patient.
- As with any moved patient, the new time also goes into the one update for that contact when staff press "Send updates".
- Replies are read by a new small reader file (like the heads-up reader), so the frozen keyword file is untouched.

## 7. At most twice

Covered by the shared counter above: at most 2 "doctor is late" contacts in total. On a 3rd, no message is sent; the patient becomes "Needs staff call – Doctor delayed again" and, if they're probably in the hospital, the front-desk alert shows "Doctor delayed again — please speak to this patient".

## 8. Everyone else (booked time not yet passed)

When their time now falls inside the longer absence:

- They become "Affected – needs contact", exactly like the original patients, and count in the banner ("16 patients affected").
- **Never contacted before:** they get the normal first WhatsApp message (if "WhatsApp OK") and join the call queue. This is their 1st contact.
- **Already rebooked or pushed by DocDelay** (Nikhil at 12:30): they lose their old answer and are contacted again, including a phone call. The existing opening is reused with their current time ("…your 12:30 PM appointment…"). On WhatsApp it is added to their existing chat.
- **As it would be built:**
  - One update per patient per contact; only the final time of that contact, only when staff press "Send updates", one channel.
  - An unsent update or heads-up for a patient who turns red is dropped.
  - No new Tamil/Hindi lines for the second contact.
  - Times go in answer order (a REVIEW.md row records this).
  - A pushed patient who turns red is affected like anyone else: they lose the 45-minute protection, and their replies are read against the normal menu, not the heads-up.
  - After the second contact, "1" means "1 – Later today" again; the second contact doesn't count against the 2 changes of answer; a second proactive WhatsApp message goes into the same chat.
  - "Another doctor today" searches from the patient's current time (12:30), not their first time (9:00).
  - The Messages page labels the later update "2nd update".
- When a patient turns red, these are cleared so the conversation starts fresh: offers on screen, a half-finished change of answer, the "1 = confirmed" state, and the heads-up state.
- The step 1 "not contacted yet" box is removed. The "Send updates" warning stays.

## 9. Frozen rules this touches, and new Tamil/Hindi lines

**Frozen chat rules:** none. The keyword file and the chat flow are not changed.

**Frozen WhatsApp rules (FRD 6.1), all now agreed as narrow exceptions for this feature only:**

| Rule today | What changes |
| --- | --- |
| One update per patient | One per "doctor is late" contact, at most 2 contacts |
| After an update, "1" = confirmed | Reset after the second contact |
| At most 2 changes of answer | The second contact isn't counted |
| One first message per chat | A second one in the same chat |
| Calls skip anyone who answered | A patient who turns red again is called again |
| A pushed patient's replies are read against the heads-up | Read against the normal menu once they turn red |
| Updates go out only when staff press "Send updates" | The waiting-check message goes out when the later time is confirmed, with no approval step |
| The tap-list depends on where the patient is | One new state: "1 – Keep waiting / 2 – Come another time" |
| After STOP, nothing on WhatsApp | Unchanged: no waiting-check message; front-desk alert only |
| WhatsApp uses basic mode only | Unchanged |

**New Tamil/Hindi lines (drafts, NOT native-checked):**

1. The message.
   - Tamil: "Maruthuvar edhirpaarthadhai vida thaamadhamaaga varuvaar. Neengal thodarndhu kaathirukka virumbugireergala, alladhu veru neraththil vara virumbugireergala? Neengal erkanave maruthuvarai paarthirundhaal, indha seidhiyai purakkanikkavum."
   - Hindi: "Doctor ko ummeed se zyada der hogi. Kya aap intezaar karna chahenge, ya kisi aur samay aana chahenge? Agar aap doctor se mil chuke hain, to kripya is sandesh ko nazarandaaz karein."
   - Meaning: "The doctor will be later than expected. Would you like to keep waiting, or come another time? If you've already seen the doctor, please ignore this message."
2. How to answer.
   - Tamil: "Kaathirukka 1, veru neraththil vara 2 ena badhilalikkavum."
   - Hindi: "Intezaar karne ke liye 1, kisi aur samay aane ke liye 2 bhejein."
   - Meaning: "Reply 1 to keep waiting, 2 to come another time."
3. Word lists for reading replies: "keep waiting" words (for example "kaathirukkiren", "wait panren", "intezaar karunga", "rukunga") and "another time" words (for example "veru neram", "vera naal", "kisi aur samay", "doosre din").

Reused, so no new wording: the hospital name at the start (as in other updates), the reply to "keep waiting" ("Thank you. Your new time is [time] today.", the existing "later today" line), and the choices after "come another time".

## 10. Tour, README and tests

- **Tour:** unchanged.
- **README:** one feature line, three lines in the WhatsApp section, and one screenshot of the front-desk alert.
- **New tests (about 70):** who counts as "probably in the hospital" (booked time passed or not, at the moment of saving); the trigger (later only); the "Are you sure?" numbers; who is asked (the 45-minute line); WhatsApp only for "WhatsApp OK" and never after STOP; an alert for every patient asked; no phone call; the message in 3 languages with no name or reason; each kind of reply, with the health check first; "keep waiting" booking exactly what "1 – Later today" would; the shared counter (2 contacts, then the staff call; a push not counted; another day resets it; another doctor today keeps it); patients turning red; unsent updates dropped; "1" meaning "later today" again; the change counter; "another doctor" from the current time; the "2nd update" label; saved steps surviving a refresh; `CLOCK_MODE` still "demo".
- **Existing tests that must change:** the step 1 tests for the "not contacted yet" list (removed with the box), and the step 1 test "a later time sends nothing" (it will now turn patients red). Every other existing test must pass unchanged.
- Browser checks at 320 and 375 px with the API key hidden and the Chat tab on "basic mode".

## Open questions (to settle when this plan is re-checked after the clock fix)

1. **The counter after moving to another day and back:** a patient who moves to another day (counter 0), then changes their answer back to today, starts again at 0, so they could be contacted up to 4 times in one day. Accept this (it should be rare), or keep the day's count if they come back to today?
2. **"Are you sure?" when the new time catches nobody:** save straight away, as today (my recommendation), or always ask?
3. **"Already passed":** is a patient booked at exactly the time now counted as in the hospital? My assumption: yes.
4. **Patients still red from the first absence whose time has passed:** I read answer 9 as "they get the waiting-check message, counted as their 2nd contact, and no phone call". Please confirm when re-checking.

## Assumptions

**⚠️ Flagged for your decision**

- A patient counted as "probably in the hospital" who is actually late, and has no WhatsApp, gets no contact at all (accepted for now; in BACKLOG as "must be solved before real patients").
- Patients still red from the first absence whose booked time has passed lose the phone call once a later time is saved, even if they never came in.
- A patient from the first absence can be contacted about a later time only once more; a second later time sends them to staff. This follows from the shared counter.
- "Keep waiting" can push other patients (within the 45-minute limit), like any "later today" answer; they get the usual heads-up.
- "Keep waiting" with no room today offers other days to a patient sitting in the waiting room.
- A patient who keeps waiting is told their time in the WhatsApp reply and again in the staff-approved update.
- Patients probably in the hospital who would wait 45 minutes or less get nothing, and stay booked at a time the doctor is away.
- A health mention from a patient probably in the hospital shows "may be in the waiting area"; nothing else about URGENT changes.
- A patient moved to Dr. Karthik who turns red (his absence got longer) can only choose later today with him, another day, or cancel: nobody covers for Dr. Karthik.
- A 3rd contact is never made by DocDelay; it relies on staff seeing "Needs staff call – Doctor delayed again".
- The two new Tamil/Hindi lines and the word lists are drafts, not native-checked.

**Minor, logged in BACKLOG.md**

- "Later" means the time bookings start at moved later.
- The booked time used, both for "already passed" and for the 45-minute line, is the patient's current time.
- The waiting-check message appears on the Messages page with its own label, "Waiting check", and is not counted as an update.
- The reader for waiting-check replies is a new file; the frozen keyword file is untouched.
- Two unclear replies to the waiting check don't create a staff call, because the patient is already on the front-desk alert.
- Patients booked after the new return time are not asked, even if they will be seen late.
- The "Are you sure?" summary counts patients, not messages.
- At the desk, staff still have [Keeps waiting] and [Wants another time] for a patient on the alert.

## Founder's answers (4 Oct 2026)

1. Yes, no approval step. Add an "Are you sure?" summary in the pop-up before saving ("This will message X patients in the waiting room, alert the front desk about Y, and turn Z red") as the safeguard against a mistyped time.
2. Yes: hospital name at the start, "Reply 1 to keep waiting, 2 to come another time" at the end, and a matching tap-list.
3. "Keep waiting" books the next fair slot today from the new return time, exactly like "1 – Later today" (same rules: empty slot first, then push within 45 minutes, 7 PM limit; no room → other days offered). The patient is told the time.
4. Nothing for patients in the hospital who would wait 45 minutes or less.
5. No: "come another time" and its follow-up choices are part of the same round. The counter only covers the current day's appointment: when a patient moves to ANOTHER DAY, it resets to 0. Moving to another doctor TODAY keeps the count.
6. No: a push doesn't count as a round.
7. One shared counter: at most 2 "doctor is late" contacts per patient in total. On a 3rd: no message; "Needs staff call – Doctor delayed again", plus a front-desk alert if they're probably in the hospital.
8. Yes, search from the patient's current time.
9. Patients probably in the hospital (point 11) who are still red from round one: front desk alert plus WhatsApp, no phone call.
10. Reply to "keep waiting": "Thank you. Your new time is [time] today." (fixed wording, no promise).
11. No check-in tracking. Remove the "Mark checked in" button and the "arrived: yes/no" mark from the plan. A patient counts as "probably in the hospital" if their booked time has already passed when the later return time is saved. Everyone else gets the normal flow. For now, a patient who is probably in the hospital but is actually late just gets the WhatsApp message.

Yes to both extra rule changes: patients who turn red again lose their old answer and are contacted (and phoned) again, and a pushed patient's replies are read against the normal menu once they turn red.

IMPORTANT: point 11 needs time to pass, which the fixed demo clock can't show. So step 2 will be built AFTER a new step: the "not before now" check plus a demo time picker.

Earlier answers (to the questions about point 8, same day): an unsent update or heads-up for a patient who turns red is dropped; the second contact reuses the existing opening with the patient's current time; round-two times go in answer order (REVIEW.md row); a pushed patient who turns red loses the 45-minute protection; the three WhatsApp exceptions (after the second contact "1" means "1 – Later today" again, the second round doesn't count against the 2 changes of answer, a second proactive WhatsApp message in the same chat); "2nd update" label on the Messages page.
