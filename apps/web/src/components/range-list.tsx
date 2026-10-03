import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type RangeRow = { id: string; range: string; label: string; reference?: boolean };

// Ranges as rows: the reference range on soft green, the person's row marked by an accent bar,
// a "you" pill and a sentence for screen readers. No judging label, no alarm colour.
export function RangeList({
  label,
  rows,
  currentId,
}: {
  label: string;
  rows: readonly RangeRow[];
  currentId: string | null;
}) {
  const { t } = useTranslation();
  return (
    <ul
      aria-label={label}
      className="overflow-hidden rounded-field border border-border bg-card text-sm"
    >
      {rows.map((row) => {
        const current = row.id === currentId;
        return (
          <li
            key={row.id}
            aria-current={current ? "true" : undefined}
            className={cn(
              "grid min-h-12 grid-cols-[76px_1fr_auto] items-center gap-2 border-t border-border px-3 first:border-t-0",
              row.reference && "bg-reference",
              current && "shadow-[inset_4px_0_0_var(--primary)]",
            )}
          >
            <span className="font-semibold tabular-nums">{row.range}</span>
            <span
              className={cn(
                "text-muted-foreground",
                row.reference && "font-semibold text-reference-ink",
              )}
            >
              {row.label}
            </span>
            {current ? (
              <>
                <span
                  aria-hidden
                  className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground"
                >
                  {t("range.you")}
                </span>
                <span className="sr-only">
                  {t("range.current", { range: row.range, label: row.label })}
                </span>
              </>
            ) : (
              <span />
            )}
          </li>
        );
      })}
    </ul>
  );
}
