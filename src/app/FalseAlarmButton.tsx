// Staff button on URGENT patients: "Mark false alarm".
// Puts the patient back to "Affected – needs contact" and logs who and when.

import { falseAlarmAction } from "./actions";
import { TAP } from "./tapTarget";

export default function FalseAlarmButton({ appointmentId }: { appointmentId: string }) {
  return (
    <form action={falseAlarmAction.bind(null, appointmentId)}>
      <button
        type="submit"
        className={`rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 ${TAP}`}
      >
        Mark false alarm
      </button>
    </form>
  );
}
