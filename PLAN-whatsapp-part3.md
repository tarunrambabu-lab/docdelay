> **PLAN ONLY — not approved yet. Waiting for the founder's answers to questions a–d.**
>
> Saved word for word from the planning session on 2026-10-03. Nothing below has been built.

I've read HANDOFF.md, BACKLOG.md, REVIEW.md, the WhatsApp code from Parts 1 and 2, the dashboard, the Messages page, the tour and the README. Here is the plan.

# WhatsApp Part 3: plan (nothing written or changed)

**Two things on your list can't be done inside the limits you set, so I need your OK before "go":**

1. **Point 4, the new first message, needs a one-line change in `src/hms/mockHms.ts`.** The first message saved in each WhatsApp chat is written by the HMS module (`openingLine`), which uses the call wording. To use WhatsApp wording, `openingLine` has to pick the new wording when the channel is WhatsApp. This changes wording only: no booking, health-check or queue logic. Without it, the screen would show the new wording before the first reply and the old "Press 4…" wording once the chat was saved.
2. **Point 3, the tour step, needs two existing tour tests updated.** One test says the tour has "6–9 steps", and a 10th step breaks it. The other walks through the tour and expects 2 updates, which becomes 3. A third test looks up step 8 by its title, so it needs updating if I rename that step (see the tour section below).

My recommendation is to allow both.

## Files

**New**
- `src/lib/whatsappStatus.ts`: small read-only helpers that work out what a row shows (the "WhatsApp OK" label, answer channel, WhatsApp state, photo notes, whether to show the link) and how each message is labelled. They only read data the screens already have; no new HMS function is needed.
- `src/lib/whatsappStatus.test.ts` and `src/app/whatsappPart3.test.ts`: the new tests.
- `src/app/WhatsAppRowLink.tsx`: a tiny link for table rows. Clicking it opens the WhatsApp chat without also opening the patient details panel, because the whole table row is clickable.
- `docs/screenshots/whatsapp.png`: the WhatsApp screen at 375 px.

**Changed**
- `src/app/page.tsx`: labels, the "Open WhatsApp" link and photo notes on each row.
- `src/app/PatientDetails.tsx`: a WhatsApp section with the chat, including voice-note text.
- `src/app/messages/page.tsx`: a channel label on every update.
- `src/app/whatsapp/[id]/page.tsx` and `WhatsAppBox.tsx`: the new first message, plus markers the tour can point at.
- `src/lib/callScript.ts`: a new `whatsappScript` with the WhatsApp wording. The call wording is untouched.
- `src/app/tour/tourSteps.ts`: the new step, plus a wording change to step 9.
- `README.md`, plus HANDOFF.md, BACKLOG.md and REVIEW.md at the end.
- **Only with your OK:** one line in `src/hms/mockHms.ts`, and the two tour tests above.

**Not touched:** `reschedulingRules.ts`, `src/lib/understanding/`, any booking, health-check or call-queue logic, the demo clock and `CLOCK_MODE`, `~/DocDelay-video`, and the FRD.

## 1. Dashboard rows

These go under the status badge, in small muted text. The status badge stays first, and URGENT keeps its red row and solid red badge, so it stays the most visible thing on the row.

- **Before contact:** a small grey-green "WhatsApp OK" label on opted-in patients.
- **After contact:** two small labels:
  - **Answer channel:** "Answered by call" or "Answered on WhatsApp". For URGENT or "Needs staff call" patients, this comes from the last line of their log.
  - **WhatsApp state:** whichever happened last of "WhatsApp sent", "Replied on WhatsApp", "Update delivered (WhatsApp)", "WhatsApp not delivered → SMS", or "WhatsApp closed (STOP)". STOP always wins.
- **"Open WhatsApp" link:** on the row for opted-in patients DocDelay has contacted, at least 44 px tall. On phone cards it sits just below the card. The link in the details panel stays.
- **Photo note:** a grey line, "📷 Photo received — not read" (with a count if there's more than one). It is separate from the status badge and the orange note, so it can never replace "Needs staff call" or URGENT, and it is never red.
- **Patient details:** a new "WhatsApp" section showing the chat. Voice notes show "🎤 Voice note · heard as: …". There is no real recording in the demo, so there's no play button.

## 2. Messages page

- **Labels:** every sent update gets one label: "WhatsApp" (green), "SMS" (grey), or "WhatsApp not delivered → sent by SMS" (amber). The heading becomes "Simulated WhatsApp and text messages".
- **How Part 1 handles "WhatsApp fails":** the mock "WhatsApp fails" patients are Divya Ramasamy (10:30), Lakshmi Subramanian (11:30) and Prakash Palanisamy (12:45). When staff press "Send updates", Part 1 decides on the spot: for these three it skips WhatsApp and sends one SMS marked "WhatsApp failed". There is **no 15-minute wait in the demo**; the code says a real system would wait 15 minutes first. Nothing is added to their WhatsApp chat, so a patient never gets both. Because the clock is fixed at 9:00 AM, a wait couldn't be shown anyway, and I won't change the clock. The page will say "(a real system waits 15 minutes first)".

## 3. Guided tour

The new step becomes **step 7 of 10**, after "Another doctor, same day".

- **New step 7, "Patients can also answer on WhatsApp":** "Tap “Back to dashboard”. Patients marked “WhatsApp OK” get a WhatsApp message too. Tap “Open WhatsApp” on Revathi Krishnan's row, then tap “1 – Later today”."
  - The ring points at "Back to dashboard", then Revathi's WhatsApp link, then the "1" button. If there's no room today, it points at offer A instead.
  - The step finishes when her answer is saved.
  - Revathi (10:00 AM, Tamil, WhatsApp OK) is the next patient still waiting after steps 4–6, and her chat opens in Tamil.
- **Steps 8 and 9 change:**
  - "The staff call list" becomes step 8; its wording doesn't change.
  - "One text per patient" becomes step 9, renamed **"One update per patient"**, with the new text "…each patient gets one update with their latest time — on WhatsApp if they agreed to it, otherwise by text." The old wording would be wrong, because in the tour all three updates (Nikhil, Kiran, Revathi) now go by WhatsApp.
- **Timing:** the new step adds about 15 seconds. I'll shorten step 3's text to keep the tour around 2 minutes.

## 4. New first WhatsApp message (not yet native-checked)

Only these sentences change from the call wording. The middle part (the doctor, the time and choices 1–3) stays as on the call.

| | English | Tamil (English letters) | Hindi (English letters) |
| --- | --- | --- | --- |
| Opening | Hello [name], this is a message from [hospital]. | Vanakkam [name], idhu [hospital] ilirundhu seidhi. | Namaste [name], yeh [hospital] se sandesh hai. |
| Option 4 | Reply 4 to speak with our front desk. | Engal varaverppu mesaiyudan pesa 4 ena badhilalikkavum. | Hamare front desk se baat karne ke liye 4 bhejein. |
| Option 5 (only when a slot is free) | Reply 5 to see another doctor from the same department today. | Indre adhe pirivai serndha veru maruthuvarai paarkka 5 ena badhilalikkavum. | Aaj hi usi vibhaag ke kisi doosre doctor se milne ke liye 5 bhejein. |
| New closing line | Reply with a number or tap an option. | Oru ennai anuppavum alladhu oru viruppathai thattavum. | Koi number bhejein ya koi vikalp chunein. |

What the Tamil and Hindi mean:
- **Opening:** "Hello [name], this is a message from [hospital]." (The call says "this is a call from".)
- **Option 4:** "To speak with our front desk, reply / send 4."
- **Option 5:** "To see another doctor from the same department today, reply / send 5."
- **Closing line:** "Send a number or tap / choose an option." "Tap an option" and "choose an option" reuse wording your mom already checked in the "Sorry…" line.

## 5. README

- **New "WhatsApp (simulated)" section:** opted-in patients only; tap or type, voice notes and photos (demo); the health check runs first; STOP must be typed and there's no STOP button; one update per patient, by WhatsApp or SMS, never both.
- **Other changes:** a line in "Key features" and one step in "A 2-minute demo".
- **Screenshot:** the WhatsApp screen at 375 px. I'll take it with the Playwright already installed in `~/DocDelay-video`, used read-only (scripts stay in my scratch folder, and nothing in that folder changes). Say if even that counts as touching it.

## 6. Phone width

Same browser check as Part 2: 320 and 375 px, Chrome's and Safari's engines, key hidden, Chat tab showing "basic mode". Pages: dashboard rows, the details panel, Messages, the WhatsApp screen and the tour step.

## Mapping to FRD 6.1

| Point | FRD 6.1 |
| --- | --- |
| 1. Dashboard rows | "What staff see" (channel and WhatsApp state); "Who gets it" (the WhatsApp OK label); "Voice notes and photos" (staff see the text and the photo note) |
| 2. Messages page | "Updates" (one per patient, never both); "SMS fallback" |
| 3. Tour | none (demo only) |
| 4. First message | "Menu" (tap-list wording); "Privacy" |
| 5. README | none |
| 6. Phone width | none |

## What's left in BACKLOG.md for WhatsApp after Part 3

- SMS replies aren't read.
- No "START" to turn WhatsApp back on after STOP.
- Real speech-to-text, and playing the recording.
- The real 15-minute fallback wait.
- Meta templates, including translating the tap-list labels, and WhatsApp consent at booking (legal review).
- The native-speaker list, now including the new first-message lines and the stop words.
- **Not in your list:** HANDOFF's Part 3 row also lists "Needs staff call · holding [time]", and BACKLOG says the dashboard must show both statuses for a patient who needs a staff call but still holds a slot. Shall I add it? It's screen-only: it shows only when a "Needs staff call" patient has a booked new time.

## New tests

1. "WhatsApp OK" label only on opted-in patients, and only before contact.
2. The "Open WhatsApp" link only for opted-in patients after contact (affected, or pushed once the heads-up is sent), never for others.
3. A photo note never replaces URGENT or "Needs staff call": the status badge and note are unchanged, and the photo line is separate and not red.
4. The answer channel is right for a call answer, a WhatsApp answer, and URGENT from WhatsApp.
5. The WhatsApp state is right for each case: sent, replied, update delivered, fallback to SMS, closed after STOP. STOP always wins.
6. The Messages page shows exactly one channel label per update, never both, and the three "WhatsApp fails" patients show the SMS fallback label.
7. The new first message never contains the visit reason (all 3 languages, all doctors' affected patients), says "Reply", and never says "Press".
8. The saved first WhatsApp message uses the new wording, and the call's first message is unchanged (the existing "Press 4… Press 5…" test still passes).
9. Option 5 appears in the first message only when a slot is free.
10. Voice-note text appears in the patient details data.
11. The new tour step: where the ring points and when the step finishes. Also checks that every marker the tour points at exists on a page.
12. The tour walkthrough with the WhatsApp step: 3 updates, all sent on WhatsApp.

## Assumptions

**⚠️ Flagged for your decision**
- **Privacy:** FRD 6.1 says messages name only the hospital, doctor and time, because previews show on lock screens. The new first message still includes the **patient's name** and the doctor's reason ("called in for an emergency surgery"), as the call does. I recommend dropping the name from the WhatsApp version ("Hello, this is a message from…"). If you'd rather keep it, I'll add it to REVIEW.md.
- **"Update delivered" is shown straight away**, because nothing is really sent. Staff might read it as "the patient has seen it".
- **"Open WhatsApp" also shows on URGENT rows.** Staff might think messaging is enough. The WhatsApp screen's red banner already says a staff member must call now; I'll keep that.
- **Photo notes are grey, with no alert**, as agreed. A photo of a wound could be overlooked (REVIEW item 3).
- **"Needs staff call · holding [time]"** isn't in this prompt (see above). Leaving it out keeps the current gap where staff can't see that a patient still holds a slot.
- **The demo video:** these changes alter what video v2 will show. The tour gets 10 steps with a WhatsApp step, rows get labels, all 3 tour updates go by WhatsApp, and the existing README dashboard screenshot becomes slightly out of date (no WhatsApp labels).

**Minor (to log in BACKLOG.md during the build)**
- The "WhatsApp OK" label shows on every opted-in row, on every day.
- Label wording and colours.
- The row link sits under the card on phones.
- The photo count.
- The step 3 text is trimmed.
- The 375 px screenshot uses English patient Nikhil Khan.

Tell me: (a) is the one-line `mockHms.ts` change OK, (b) can I update the two tour tests, (c) keep or drop the patient's name in the WhatsApp first message, and (d) should I add "Needs staff call · holding [time]"? Then say "go".

---

## Claude chat's suggestions (not decided yet)

- **(a)** The one-line `mockHms.ts` wording change: OK.
- **(b)** Update the two tour tests: OK.
- **(c)** Drop the patient's name AND the doctor's reason ("called in for an emergency surgery") from the first WhatsApp message, to match FRD 6.1 privacy (hospital, doctor, time only). The new lines need my mom's check.
- **(d)** Add "Needs staff call · holding [time]": yes.
- Show "Update sent" instead of "Update delivered", so staff don't think the patient has read it.
- **Question:** the tour's WhatsApp step uses Revathi, whose chat is in Tamil. Is that clear for English-speaking visitors?
