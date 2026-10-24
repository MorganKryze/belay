import type { ReactNode } from "react";
import { cardSurface } from "@/components/surfaces";
import { useEditor } from "./editor-context";
import { ExerciseSearch } from "./exercise-search";

// The shown session on the kit card: its heading on the left, the search and its actions on the
// right of one row, then its table. Below 1 024 px the search takes a row of its own and the table
// scrolls inside the card, never the page. The search comes after the table in reading order, so
// Tab out of the table reaches it before the rest of the page.
export function SessionCard({
  heading,
  actions,
  children,
}: {
  heading: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  const { shown } = useEditor();
  return (
    <section
      className={`${cardSurface} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pt-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,28rem)_auto]`}
    >
      <div className="col-start-1 row-start-1 min-w-0 pl-4">{heading}</div>
      <div className="col-start-2 row-start-1 flex items-center gap-2 pr-4 empty:hidden lg:col-start-3">
        {actions}
      </div>
      <div className="col-span-full row-start-3 overflow-x-auto pb-2 lg:row-start-2">
        {children}
      </div>
      {shown && (
        <div
          className={`col-span-full row-start-2 px-4 lg:col-span-1 lg:col-start-2 lg:row-start-1 ${actions ? "lg:px-0" : "lg:pl-0"}`}
        >
          <ExerciseSearch key={shown.session.id} placed={shown} />
        </div>
      )}
    </section>
  );
}
