import type { ReactNode } from "react";
import { cardSurface } from "@/components/surfaces";

// The shown session on the kit card: its heading on the left, its actions on the right of one row,
// then its table. Below 1 024 px the table scrolls inside the card, never the page.
export function SessionCard({
  heading,
  actions,
  children,
}: {
  heading: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cardSurface}>
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3.5 pb-3">
        <div className="min-w-0 flex-1">{heading}</div>
        {actions}
      </div>
      <div className="overflow-x-auto pb-2">{children}</div>
    </section>
  );
}
