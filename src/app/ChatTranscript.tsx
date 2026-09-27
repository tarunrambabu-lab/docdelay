// Shows a chat conversation: DocDelay on the left, the patient on the right.
// Under each patient message, a small grey note shows what DocDelay
// understood (for staff — patients never see this).
// Used in the call simulator (Chat mode) and in the dashboard's patient details.

import type { ChatTurn, Language } from "@/hms/types";

const languageCodes: Record<Language, string> = { English: "en", Tamil: "ta", Hindi: "hi" };

export default function ChatTranscript({
  turns,
  language,
  dark = false,
}: {
  turns: ChatTurn[];
  language: Language;
  dark?: boolean; // dark = inside the phone card
}) {
  return (
    <ol className="space-y-3">
      {turns.map((turn, i) =>
        turn.from === "docdelay" ? (
          <li key={i} className="max-w-[85%]">
            <p
              className={`mb-1 text-[11px] uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`}
            >
              DocDelay
            </p>
            <p
              lang={languageCodes[language]}
              className={`rounded-2xl rounded-tl-sm p-3 text-sm leading-relaxed ${
                dark ? "bg-white/10 text-white" : "bg-slate-100 text-slate-800"
              }`}
            >
              {turn.text}
            </p>
          </li>
        ) : (
          <li key={i} className="ml-auto max-w-[85%] text-right">
            <p
              className={`mb-1 text-[11px] uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`}
            >
              Patient
            </p>
            <p className="inline-block rounded-2xl rounded-tr-sm bg-teal-600 p-3 text-left text-sm leading-relaxed text-white">
              {turn.text}
            </p>
            {turn.understood && (
              <p className={`mt-1 text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
                understood: {turn.understood}
              </p>
            )}
          </li>
        ),
      )}
    </ol>
  );
}
