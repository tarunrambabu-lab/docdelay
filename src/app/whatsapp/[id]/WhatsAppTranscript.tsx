// The WhatsApp conversation as chat bubbles: DocDelay on the left, the patient
// on the right. Every bubble shows its time — from the app's clock
// (bubbleTime: 9:00 AM in the demo), never the computer's real time.
// Under each patient message, a small note shows what DocDelay understood
// (for staff — patients never see this).
//
// A voice note shows a "Voice note" label with the text DocDelay heard.
// A photo shows a placeholder: DocDelay never reads photos.

import type { ChatTurn, Language } from "@/hms/types";
import { bubbleTime } from "./whatsappMenu";

const languageCodes: Record<Language, string> = { English: "en", Tamil: "ta", Hindi: "hi" };

export default function WhatsAppTranscript({
  turns,
  language,
}: {
  turns: ChatTurn[];
  language: Language;
}) {
  return (
    <ol className="space-y-3">
      {turns.map((turn, i) =>
        turn.from === "docdelay" ? (
          <li key={i} className="max-w-[85%]">
            <div className="rounded-2xl rounded-tl-sm bg-white p-3 text-sm leading-relaxed text-slate-800 shadow-sm">
              <p lang={languageCodes[language]} className="wrap-break-word">
                {turn.text}
              </p>
              <p className="mt-1 text-right text-[11px] tabular-nums text-slate-400">
                {bubbleTime(turn.at)}
              </p>
            </div>
          </li>
        ) : (
          <li key={i} className="ml-auto max-w-[85%] text-right">
            <div className="inline-block max-w-full rounded-2xl rounded-tr-sm bg-emerald-100 p-3 text-left text-sm leading-relaxed text-slate-900 shadow-sm">
              {turn.media === "photo" ? (
                // A placeholder picture — there is no real photo.
                <div
                  data-media="photo"
                  className="flex h-24 w-36 max-w-full items-center justify-center rounded-lg bg-emerald-200 text-xs font-medium text-emerald-900"
                >
                  📷 Photo
                </div>
              ) : (
                <>
                  {turn.media === "voice" && (
                    <p data-media="voice" className="mb-1 text-xs font-medium text-emerald-800">
                      🎤 Voice note · heard as:
                    </p>
                  )}
                  <p className="wrap-break-word">{turn.text}</p>
                </>
              )}
              <p className="mt-1 text-right text-[11px] tabular-nums text-slate-500">
                {bubbleTime(turn.at)}
              </p>
            </div>
            {turn.understood && (
              <p className="mt-1 text-[11px] wrap-break-word text-slate-500">
                understood: {turn.understood}
              </p>
            )}
          </li>
        ),
      )}
    </ol>
  );
}
