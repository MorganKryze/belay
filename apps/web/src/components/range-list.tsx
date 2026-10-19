import { useId } from "react";
import { useTranslation } from "react-i18next";
import { groupSurface, sectionLabel } from "@/components/surfaces";
import { cn } from "@/lib/utils";

export type RangeRow = { id: string; range: string; label: string; reference?: boolean };

// Ranges as rows on the kit's group surface (one shared grid, so the range column is as wide as its
// widest range): the reference range on soft green, the person's row marked by the "you" pill alone,
// in its own colours whatever row it sits in, and a sentence for screen readers. No judging label,
// no alarm colour. With `heading`, the label shows above the list as a section label and names it.
export function RangeList({
  label,
  rows,
  currentId,
  heading = false,
}: {
  label: string;
  rows: readonly RangeRow[];
  currentId: string | null;
  heading?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const list = (
    <ul
      aria-label={heading ? undefined : label}
      aria-labelledby={heading ? id : undefined}
      className={`${groupSurface} grid grid-cols-[auto_1fr_auto] text-sm`}
    >
      {rows.map((row) => {
        const current = row.id === currentId;
        return (
          <li
            key={row.id}
            aria-current={current ? "true" : undefined}
            className={cn(
              "col-span-3 grid min-h-12 grid-cols-subgrid items-center gap-2 border-t border-border px-3 first:border-t-0",
              row.reference && "bg-reference",
            )}
          >
            <span className="font-semibold whitespace-nowrap tabular-nums">{row.range}</span>
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
  if (!heading) return list;
  return (
    <div className="flex flex-col gap-2">
      <h2 id={id} className={sectionLabel}>
        {label}
      </h2>
      {list}
    </div>
  );
}
