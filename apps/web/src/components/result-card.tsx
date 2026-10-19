import { type ReactNode, useId } from "react";
import { cardSurface } from "@/components/surfaces";
import { cn } from "@/lib/utils";

// The result of a tool on the kit card. Always mounted, so screen readers announce each new
// result (a live region added together with its text is often missed).
export function ResultCard({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      aria-live="polite"
      aria-atomic="true"
      className={`${cardSurface} flex flex-col gap-1 px-4 py-3.5`}
    >
      <h2 id={id} className="text-[13px] font-semibold text-muted-foreground">
        {label}
      </h2>
      {children}
    </section>
  );
}

// The charter's figure for a tool: large for one number or one range, medium for a pair. The unit
// follows a no-break space by default, so the figure wraps only between its own words and never
// leaves its unit alone on a line.
export function ResultFigure({
  value,
  unit,
  size = "large",
  muted = false,
  unitSpace = " ",
}: {
  value: string;
  unit?: string;
  size?: "large" | "medium";
  muted?: boolean;
  unitSpace?: string;
}) {
  return (
    // A plain string, not cn(): the merge takes the custom text-figure size for a color and drops
    // it in favor of text-foreground.
    <div
      data-slot="result-figure"
      className={`${size === "medium" ? "text-figure-md" : "text-figure"} tabular-nums ${muted ? "text-muted-foreground" : "text-foreground"}`}
    >
      {value}
      {unit && (
        <span
          className={cn(
            "font-semibold tracking-normal text-muted-foreground",
            size === "medium" ? "text-[14px]" : "text-[17px]",
          )}
        >
          {unitSpace}
          {unit}
        </span>
      )}
    </div>
  );
}
