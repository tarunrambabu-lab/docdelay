"use client";

// A table row you can click to open the patient's details
// (the patient's name inside the row is also a normal link, for keyboards).

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export default function ClickableRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      onClick={() => router.push(href, { scroll: false })}
      className={`cursor-pointer ${className ?? ""}`}
    >
      {children}
    </tr>
  );
}
