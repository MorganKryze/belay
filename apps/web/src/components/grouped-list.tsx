import { createLink } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { Children, type ComponentProps, forwardRef, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

export type RowProps = {
  icon?: LucideIcon;
  label: string;
  value?: ReactNode;
  trailing?: "push" | "menu" | "none";
  destructive?: boolean;
};

export const groupCard =
  "divide-y divide-border overflow-hidden rounded-group bg-surface shadow-card dark:border dark:border-border";
export const sectionLabel = "px-4 text-section text-muted-foreground";

const row =
  "press-tint flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2";

// The label keeps its own width (basis-auto) so a value that no longer fits wraps under it
// instead of squeezing it; only a label wider than the row ends in an ellipsis. A value with no
// break opportunity breaks inside its words rather than pushing the row wider than the screen.
function RowContent({ icon: Icon, label, value, trailing = "none", destructive }: RowProps) {
  // A destructive row is red text alone: no icon, no value, no chevron to dress it up.
  if (destructive) {
    return (
      <span className="min-w-0 flex-1 truncate text-body font-semibold text-destructive">
        {label}
      </span>
    );
  }
  const Chevron = trailing === "push" ? ChevronRight : trailing === "menu" ? ChevronDown : null;
  return (
    <>
      {Icon && (
        <span
          data-slot="row-icon"
          className="flex size-7 shrink-0 items-center justify-center rounded-icon bg-primary-soft"
        >
          <Icon aria-hidden="true" className="size-5 text-primary-ink" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3">
        <span className="min-w-0 flex-1 basis-auto truncate text-body font-semibold">{label}</span>
        {value != null && (
          <span className="min-w-0 text-body break-words text-muted-foreground">{value}</span>
        )}
      </span>
      {Chevron && (
        <Chevron
          data-slot="row-chevron"
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      )}
    </>
  );
}

type AnchorRowProps = RowProps & Omit<ComponentProps<"a">, keyof RowProps>;

const RowAnchor = forwardRef<HTMLAnchorElement, AnchorRowProps>(function RowAnchor(
  { icon, label, value, trailing, destructive, className, ...rest },
  ref,
) {
  return (
    <a ref={ref} {...rest} className={cn(row, className)}>
      <RowContent {...{ icon, label, value, trailing, destructive }} />
    </a>
  );
});

export const RowLink = createLink(RowAnchor);

export function RowButton({
  icon,
  label,
  value,
  trailing,
  destructive,
  className,
  type = "button",
  ...rest
}: RowProps & Omit<ComponentProps<"button">, keyof RowProps>) {
  return (
    <button type={type} {...rest} className={cn(row, className)}>
      <RowContent {...{ icon, label, value, trailing, destructive }} />
    </button>
  );
}

// One card of rows under an optional section label; each child is one row.
export function GroupedList({ label, children }: { label?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="flex flex-col gap-2">
      {label && (
        <h2 id={id} className={sectionLabel}>
          {label}
        </h2>
      )}
      <ul aria-labelledby={label ? id : undefined} className={groupCard}>
        {Children.map(children, (child) => (child == null ? null : <li>{child}</li>))}
      </ul>
    </section>
  );
}

export function EmptyState({
  sentence,
  precision,
  action,
}: {
  sentence: string;
  precision: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <p className="text-body font-semibold">{sentence}</p>
      <p className="text-body text-muted-foreground">{precision}</p>
      {action}
    </div>
  );
}

// For data that comes from the network only: local data is already there on the first frame, so
// it never shows a skeleton. Static on purpose, a shimmer would be motion with no meaning.
export function SkeletonRows({ count }: { count: number }) {
  return (
    <div aria-hidden="true" className={groupCard}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          data-slot="skeleton-row"
          className="flex min-h-14 items-center gap-3 px-4 py-2"
        >
          <div className="size-7 shrink-0 rounded-icon bg-track" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-3 w-1/2 rounded-round bg-track" />
            <div className="h-3 w-1/3 rounded-round bg-track" />
          </div>
        </div>
      ))}
    </div>
  );
}
