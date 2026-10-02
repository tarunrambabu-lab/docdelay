# DocDelay — Decisions to review

Decisions we've made but aren't sure about, to look at again later. (New ideas and things to build go in BACKLOG.md.)

Review before: real patients, or earlier if the date says so.

| Date | What we decided | Why we're not sure | What would settle it | When to review |
| --- | --- | --- | --- | --- |
| 3 Oct 2026 | "ruko" / "rukiye" are NOT treated as "stop" in a pushed patient's voice note, so they still go to a staff call. | "ruko" means both "stop" and "wait". If it means "I'll wait", treating it as stop would hide it from staff. | A native-speaker check, plus real patient messages. | Phase 2 clinic interviews |
| 3 Oct 2026 | Tamil/Hindi stop words in a pushed patient's voice note: niruthu, niruthunga, niruthidunga, band karo, band kar do, band kijiye (list in `src/hms/mockHms.ts`). | "band karo" can also mean "switch it off". | My mom's native check, then a second native speaker. | Before real patients |
| 2 Oct 2026 | Photos are never health-checked: a photo of a wound or a report gets only the "Sorry… if this is an emergency, call 108" line, with no URGENT. | A patient may send a photo instead of describing a health problem in words, and DocDelay can't read it. | Clinician advice. | Phase 2 |
| 1 Oct 2026 | After STOP, or from a patient not opted in to WhatsApp, a health mention gets only the 108 reply: no URGENT, no staff note. | We assumed a patient with a real emergency would call 108 rather than type it. Not clinician-checked. | Clinician advice. | Phase 2 |
| 2 Oct 2026 | An unclear message after the patient has already answered is never counted (no "two unclear replies → staff call"). | A patient asking for help in words DocDelay doesn't know may never reach staff. | Clinician advice, plus real patient messages. | Phase 2 |
| 3 Oct 2026 | The "I'm unwell" button on the WhatsApp tap-list: it sends a fixed sentence and goes URGENT. Kept as it is for now. | The founder isn't convinced it should exist. Possible concerns: too easy to tap, so false alarms that tire staff; vague ("how unwell?"); patients may think it gets them seen sooner; a health button may suggest DocDelay asks about health. | The founder's decision, plus clinic staff and clinician views. | Phase 2 clinic interviews |

## Settled

| Date | What was settled |
| --- | --- |
| 3 Oct 2026 | The Tamil/Hindi "Sorry, I couldn't understand that…" line and "I'm unwell" sentences were checked by a native speaker (my mom) and are correct. |
