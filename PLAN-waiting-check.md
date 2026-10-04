> **PLAN ONLY — not approved.** Saved word for word from the planning session on 4 Oct 2026. Nothing below has been built.

# Waiting check, step 2 (option A): plan

I've read HANDOFF.md, BACKLOG.md, REVIEW.md, PLAN-doctor-back.md and the code this touches: the HMS module, the WhatsApp rules, the heads-up reader, the saved demo steps, the dashboard, the staff call list and the Messages page. No code was written for this part.

## What happens, in one picture

Staff enter a later return time (12:00 → 2:00 PM). At that moment, for every patient of that doctor whose time today is now inside the absence:

| Patient | What happens |
| --- | --- |
| **Checked in**, and would wait more than 45 minutes past their booked time | Asked the waiting check on WhatsApp (if "WhatsApp OK"), and always put on a front-desk alert. No phone call. |
| **Checked in**, would wait 45 minutes or less | Not asked (Question 4). |
| **Not checked in**, fewer than 2 rounds so far | Turns red ("Affected – needs contact") and goes through the normal flow. |
| **Not checked in**, already had 2 rounds | "Needs staff call – Doctor delayed again". Booking kept. |
| Already red, with staff, URGENT, cancelled, or moved to another day | Nothing changes. |

"Later" means the time bookings start at has moved later (12:00 → 2:00). An earlier time, or 10:00 → 11:00 when the first time was 12:00, triggers nothing.

## 1. "Checked in"

- Each appointment gets one new piece of information: arrived, yes or no. Nothing else (no arrival time, no location).
- It sits in the HMS module's data shapes, so a real HMS can supply it later.
- Demo: a "Mark checked in" button in the patient details panel, with "Undo". Checked-in patients show a small "Checked in" label on their row.
- It is saved as a new demo step, so a refresh keeps it.

## 2. When to ask

As soon as a later return time is saved, from "Change expected return time" or "Still away" in the system check. No moving clock; `CLOCK_MODE` stays "demo".

Before saving, the pop-up shows what will happen, for example: "Saving will message 2 checked-in patients on WhatsApp, alert the front desk about 3, and turn 5 patients red." The waiting-check messages go out at once, with no staff-approval step (decided 4 Oct). See Question 1.

## 3. Who is asked

Checked-in patients, with this doctor today, whose current booked time is inside the absence, and where the new return time is more than 45 minutes after that booked time. Example with a return at 2:00 PM: booked 12:00, 12:15, 12:45, 1:00 → asked; booked 1:15 (exactly 45 minutes) or 1:30 → not asked.

The "booked time" is the patient's current time, the one they were last told.

## 4. How

- **WhatsApp** for "WhatsApp OK" patients who haven't sent STOP.
- **A front-desk alert for every checked-in patient asked**, WhatsApp or not: a new panel on the dashboard, "Checked-in patients to speak to", and the same rows in the staff call list. Each row shows the patient, their booked time, and their answer so far ("No answer yet", "Keeps waiting", "Wants another time").
- For patients without WhatsApp, the alert is the only channel. Staff ask them in person and press [Keeps waiting] or [Wants another time].
- No phone call: checked-in patients are left out of the call queue.

## 5. The message

English (as you gave it, plus a line saying how to answer):

"[Hospital]: The doctor will be later than expected. Would you like to keep waiting, or come another time? If you've already seen the doctor, please ignore this message. Reply 1 to keep waiting, 2 to come another time."

No reason, no patient name, no doctor name. The hospital name and the "Reply 1 … 2 …" line are my additions (Question 2).

## 6. Replies

- **Health check first**, as on every WhatsApp message. A health mention → URGENT, and the alert says "checked in: the patient is in the waiting area", so staff walk over instead of phoning.
- **"1" / "I'll wait" → Keeps waiting.** Nothing moves. The patient is marked "Keeps waiting" for the step 3 waiting list. Reply: "Thank you. Please stay in the waiting area. Our front desk will call you when the doctor is back."
- **"2" / "another time" → the existing fair rules.** The patient turns red and gets the existing choices (later today, another day, another doctor, cancel, talk to a person). On WhatsApp they answer there in basic mode; without WhatsApp, staff use the existing Buttons screen at the desk. This starts a round (see point 8).
- **Anything unclear:** the existing "Sorry, I couldn't understand that…" line. The patient is on the front-desk alert anyway.
- **No reply:** nothing happens; the alert stays "No answer yet".
- Replies are read by a new small reader file (like the heads-up reader), so the frozen keyword file is untouched.
- The WhatsApp tap-list shows "1 – Keep waiting / 2 – Come another time" while the question is open.

## 7. At most twice

Each checked-in patient is asked at most twice. If the return time is made later a third time, no message is sent; the front-desk alert shows "Doctor delayed again — please speak to this patient".

## 8. Patients NOT checked in

When their time now falls inside the longer absence:

- They become "Affected – needs contact", exactly like the original patients, and count in the banner ("16 patients affected").
- **Never contacted before:** they get the normal first WhatsApp message (if "WhatsApp OK") and join the call queue. This is their round 1.
- **Already rebooked or pushed by DocDelay** (Nikhil at 12:30): contacted a second time. The existing opening is reused with their current time ("…your 12:30 PM appointment…"). On WhatsApp it is added to their existing chat. They join the call queue even though they answered before.
- **Your answers a–g, as they would be built:**
  - a. One update per patient per round, at most 2 rounds. A third round → "Needs staff call – Doctor delayed again", no contact, booking kept.
  - b. An unsent update or heads-up for a patient who turns red is dropped.
  - c. No new Tamil/Hindi lines for the second contact.
  - d. Round two times go in answer order. A REVIEW.md row is added when this is built.
  - e. A pushed patient who turns red loses the 45-minute protection.
  - f. After the second contact, "1" means "1 – Later today" again; the second round doesn't count against the 2 changes of answer; a second proactive WhatsApp message goes into the same chat.
  - g. The Messages page labels the later one "2nd update".
- When a patient turns red, these are cleared so the conversation starts fresh: offers on screen, a half-finished change of answer, the "1 = confirmed" state, and the heads-up state.
- The step 1 "not contacted yet" box is removed. The "Send updates" warning stays; it now mostly catches checked-in patients with an unsent update.

## 9. Frozen rules this touches, and new Tamil/Hindi lines

**Frozen chat rules:** none. The keyword file and the chat flow are not changed.

**Frozen WhatsApp rules (FRD 6.1):**

| Rule today | What changes | Covered by your answers? |
| --- | --- | --- |
| One update per patient | One per round, at most 2 rounds | Yes (8a) |
| After an update, "1" = confirmed | Reset after the second contact | Yes (8f) |
| At most 2 changes of answer | The second round isn't counted | Yes (8f) |
| One first message per chat | A second one in the same chat | Yes (8f) |
| Calls skip anyone who answered | A patient who turns red again is called again | Follows from point 8; please confirm |
| A pushed patient's replies are read against the heads-up | Not after they turn red | Follows from 8e; please confirm |
| Updates go out only when staff press "Send updates" | The waiting-check message goes out at once, with no approval | **No** (Question 1) |
| The tap-list depends on where the patient is | One new state: "1 – Keep waiting / 2 – Come another time" | **No** (Question 2) |
| After STOP, nothing on WhatsApp | Unchanged: no waiting-check message; front-desk alert only | Not touched |
| WhatsApp uses basic mode only | Unchanged | Not touched |

**New Tamil/Hindi lines (drafts, NOT native-checked):**

1. The message.
   - Tamil: "Maruthuvar edhirpaarthadhai vida thaamadhamaaga varuvaar. Neengal thodarndhu kaathirukka virumbugireergala, alladhu veru neraththil vara virumbugireergala? Neengal erkanave maruthuvarai paarthirundhaal, indha seidhiyai purakkanikkavum."
   - Hindi: "Doctor ko ummeed se zyada der hogi. Kya aap intezaar karna chahenge, ya kisi aur samay aana chahenge? Agar aap doctor se mil chuke hain, to kripya is sandesh ko nazarandaaz karein."
   - Meaning: "The doctor will be later than expected. Would you like to keep waiting, or come another time? If you've already seen the doctor, please ignore this message."
2. How to answer.
   - Tamil: "Kaathirukka 1, veru neraththil vara 2 ena badhilalikkavum."
   - Hindi: "Intezaar karne ke liye 1, kisi aur samay aane ke liye 2 bhejein."
   - Meaning: "Reply 1 to keep waiting, 2 to come another time."
3. The reply to "keep waiting".
   - Tamil: "Nandri. Dhayavuseidhu kaathiruppu araiyil irungal. Maruthuvar vandhadhum engal varaverppu mesai ungalai azhaikkum."
   - Hindi: "Dhanyavaad. Kripya pratiksha kaksh mein rahein. Doctor ke aate hi hamara front desk aapko bulaayega."
   - Meaning: "Thank you. Please stay in the waiting area. Our front desk will call you when the doctor is back."
4. Word lists for reading replies: "keep waiting" words (for example "kaathirukkiren", "wait panren", "intezaar karunga", "rukunga") and "another time" words (for example "veru neram", "vera naal", "kisi aur samay", "doosre din").

The reply to "come another time" reuses the existing choices line (already on the review list).

## 10. Tour, README and tests

- **Tour:** unchanged.
- **README:** one feature line, three lines in the WhatsApp section, and one screenshot of the front-desk alert.
- **New tests (about 60):** the checked-in mark and undo; the trigger (later only); who is asked (the 45-minute line); WhatsApp only for "WhatsApp OK" and never after STOP; an alert for every patient asked; no phone call; the message in 3 languages with no name or reason; each kind of reply, with the health check first; at most twice; patients turning red; unsent updates dropped; 2 rounds, then the staff call; "1" meaning "later today" again; the change counter; the "2nd update" label; saved steps surviving a refresh; `CLOCK_MODE` still "demo".
- **Existing tests that must change:** the step 1 tests for the "not contacted yet" list (removed with the box), and the step 1 test "a later time sends nothing" (it will now turn patients red). Every other existing test must pass unchanged.
- Browser checks at 320 and 375 px with the API key hidden and the Chat tab on "basic mode".

## Questions before "go"

1. **No approval for the waiting-check message:** it is sent the moment the later time is saved. Confirm this, and is the "Saving will…" summary in the pop-up OK as the safeguard?
2. **The message:** OK to add the hospital name at the start and "Reply 1 to keep waiting, 2 to come another time" at the end, plus the new tap-list state?
3. **"Keep waiting" gives no time; "come another time → later today" gives a firm slot** from the return time. A patient who keeps waiting could be overtaken by one who picks "later today". Accept this until the waiting list (step 3), or should "keep waiting" give the next fair slot?
4. **Checked-in patients who would wait 45 minutes or less:** nothing at all, or listed on the front-desk alert as "not asked"?
5. **Checked-in patients who choose "come another time"** turn red and use the normal choices (WhatsApp, or Buttons at the desk, no phone call). Does that count as a round?
6. **Does a push count as a round?** My recommendation: no. A pushed patient who turns red starts round 1.
7. **Do waiting-check questions and rounds share one counter,** or are they separate (at most 2 questions and at most 2 rounds)? My recommendation: separate.
8. **"Another doctor" in round two:** search from the patient's current time (12:30) instead of their first time (9:00)? My recommendation: current time.
9. **A checked-in patient who is still red from round one** (arrived at 8:50 for 9:00, not yet answered): leave them in the normal flow, including the phone call, or move them to the front desk?
10. **Reply wording for "keep waiting":** is "Our front desk will call you when the doctor is back" a promise you're happy to make?

## Assumptions

**⚠️ Flagged for your decision**

- The waiting-check message is sent without staff approval; a mistyped later time would message patients at once (Question 1).
- "Keep waiting" patients hold no time after the doctor's return and can be overtaken (Question 3).
- Checked-in patients who would wait 45 minutes or less get nothing, and are booked at a time the doctor is away (Question 4).
- A health mention from a checked-in patient shows "in the waiting area" so staff go to them; nothing else about URGENT changes.
- Patients who turn red again are phoned again, although "calls skip anyone who answered".
- A patient moved to Dr. Karthik who turns red (his absence got longer) can only choose later today with him, another day, or cancel: nobody covers for Dr. Karthik.
- A wrongly pressed "Mark checked in" would stop that patient from being contacted through the normal flow; "Undo" is the only guard.
- Round two's "another doctor" search starts from which time (Question 8).
- A third round is never contacted by DocDelay; it relies on staff seeing "Needs staff call – Doctor delayed again".
- All three new Tamil/Hindi lines and the word lists are drafts, not native-checked.

**Minor, logged in BACKLOG.md**

- "Later" means the time bookings start at moved later.
- The booked time used for the 45-minute line is the patient's current time.
- "Mark checked in" sits in the patient details panel, with "Undo" and a small row label.
- The waiting-check message appears on the Messages page with its own label, "Waiting check", and is not counted as an update.
- The reader for waiting-check replies is a new file; the frozen keyword file is untouched.
- Two unclear replies to the waiting check don't create a staff call, because the patient is already on the front-desk alert.
- Checked-in patients booked after the new return time are not asked, even if they will be seen late.
- The REVIEW.md row for round-two answer order is added when this is built.
