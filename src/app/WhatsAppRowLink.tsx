"use client";

// The "Open WhatsApp" link on a dashboard row (WhatsApp Part 3).
// The whole table row is clickable (it opens the patient's details), so this
// link stops the click there: tapping it opens only the WhatsApp chat.
// At least 44 px tall, on every screen size.

import Link from "next/link";
import { TOUR_WHATSAPP_APPOINTMENT } from "./tour/tourSteps";

export default function WhatsAppRowLink({ appointmentId }: { appointmentId: string }) {
  return (
    <Link
      href={`/whatsapp/${appointmentId}`}
      onClick={(e) => e.stopPropagation()}
      // The guided tour points at this patient's link (tour step 7).
      data-tour={appointmentId === TOUR_WHATSAPP_APPOINTMENT ? "tour-whatsapp-link" : undefined}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-xs font-medium text-teal-700 hover:underline"
    >
      Open WhatsApp →
    </Link>
  );
}
