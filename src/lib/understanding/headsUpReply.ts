// Reading a reply to the HEADS-UP message that pushed patients get:
//   "Your appointment may start up to 15 minutes later, around 12:30 PM.
//    Reply 1 if that's fine, 2 to cancel, 3 to talk to a person."
//
// These replies are read against THAT message — never against the main menu
// (where 1 = later today, 2 = another day, 3 = cancel). This file only READS
// the reply; the hms module decides what happens.
//
// ⚠️ The Tamil and Hindi words were written for this demo and must be checked
// by native speakers before real use.

export type HeadsUpReading =
  | "fine" // "1", "ok" — nothing changes
  | "cancel" // "2", or cancel wording — DocDelay asks "Reply YES to cancel"
  | "yes" // the answer to that question
  | "no" // "no" to that question — also "don't cancel", "cancel venaam"
  | "other"; // "3", another day, or anything else → front desk

// Whole messages that mean "yes" / "no" / "that's fine".
const YES = ["yes", "yes cancel", "yes please", "aam", "aama", "aamam", "ஆம்", "ஆமா", "ஆமாம்", "haan", "han", "haa", "ji haan", "haan ji", "हाँ", "हां", "जी हाँ", "जी हां"];
const NO = ["no", "nope", "illa", "illai", "venaam", "venam", "vendam", "vendaam", "இல்லை", "வேண்டாம்", "nahi", "nahin", "नहीं"];
const FINE = [
  "ok", "okay", "k", "fine", "thats fine", "that is fine", "ok thanks", "ok thank you", "no problem",
  "sari", "seri", "paravailla", "சரி",
  "theek hai", "thik hai", "theek", "ठीक है",
];

// Cancel wording beyond the chat's own cancel words (which the hms module
// passes in as `understoodAsCancel`).
const CANCEL = ["cancel", "cant come", "cannot come", "can not come", "varamudiyadhu", "varamudiyathu", "vara mudiyadhu", "vara mudiyathu", "ரத்து", "रद्द"];

// "don't cancel", "cancel venaam", "cancel mat karo": the word "cancel" next to
// a "no" word must NEVER be read as wanting to cancel.
const CANCEL_WORD = /(^|\s)(cancel\w*|ரத்து|கேன்சல்|रद्द|कैंसल)(\s|$)/u;
const NOT_WORD =
  /(^|\s)(not|dont|never|no|venaam|venam|vendam|vendaam|venda|vendaa|venaa|pannadheenga|pannaadheenga|mat|nahi|nahin|nai|வேண்டாம்|मत|नहीं)(\s|$)/u;

// Lower case, apostrophes dropped ("don't" → "dont"), other punctuation → spaces.
function tidy(message: string): string {
  return message
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[.,!?;:"()।-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// `understoodAsCancel`: the rule-based chat understanding read it as "cancel".
export function readHeadsUpReply(message: string, understoodAsCancel: boolean): HeadsUpReading {
  const t = tidy(message);
  // The numbers in the heads-up come first (so "3" is never the menu's "cancel").
  if (t === "1") return "fine";
  if (t === "2") return "cancel";
  if (/^\d+$/.test(t)) return "other"; // "3", or any other number
  if (YES.includes(t)) return "yes";
  if (NO.includes(t)) return "no";
  if (FINE.includes(t)) return "fine";
  if (CANCEL_WORD.test(t) && NOT_WORD.test(t)) return "no"; // "don't cancel"
  if (understoodAsCancel || CANCEL.some((w) => ` ${t} `.includes(` ${w} `))) return "cancel";
  return "other";
}
