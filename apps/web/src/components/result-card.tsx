import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

// Always mounted, so screen readers announce each new result (a live region added together
// with its text is often missed). `plain` is for list results such as the warm-up sets.
export function ResultCard({
  label,
  tone = "soft",
  children,
}: {
  label: string;
  tone?: "soft" | "plain";
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "flex flex-col gap-1 rounded-card p-4",
        tone === "soft" ? "bg-primary-soft" : "border border-border bg-card",
      )}
    >
      <h2
        id={id}
        className={cn(
          "text-[13px] font-semibold",
          tone === "soft" ? "text-primary-ink" : "text-muted-foreground",
        )}
      >
        {label}
      </h2>
      {children}
    </section>
  );
}
