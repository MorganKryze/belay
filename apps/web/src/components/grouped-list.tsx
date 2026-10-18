import { createLink } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { Children, type ComponentProps, forwardRef, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

export type RowProps = {
  icon?: LucideIcon;
  // Drawn in place of the icon square, as the profile row's avatar.
  leading?: ReactNode;
  label: string;
  // A muted second line under the label, cut to one line.
  sub?: string;
  value?: ReactNode;
  trailing?: "push" | "menu" | "none";
  // The 17 px label of a row that heads the page, at least 72 px high.
  prominent?: boolean;
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
// The whitespace between the label and what follows it takes no room in the flex row, but keeps
// the words apart in the row's accessible name.
function RowContent({
  icon: Icon,
  leading,
  label,
  sub,
  value,
  trailing = "none",
  prominent,
  destructive,
}: RowProps) {
  // A destructive row is red text alone, centred: no icon, no value, no chevron to dress it up.
  if (destructive) {
    return (
      <span className="min-w-0 truncate text-center text-body font-semibold text-destructive">
        {label}
      </span>
    );
  }
  const Chevron = trailing === "push" ? ChevronRight : trailing === "menu" ? ChevronDown : null;
  return (
    <>
      {leading != null ? (
        <span data-slot="row-leading" className="flex shrink-0">
          {leading}
        </span>
      ) : (
        Icon && (
          <span
            data-slot="row-icon"
            className="flex size-7 shrink-0 items-center justify-center rounded-icon bg-primary-soft"
          >
            <Icon aria-hidden="true" className="size-5 text-primary-ink" />
          </span>
        )
      )}
      <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3">
        {sub ? (
          <span className="flex min-w-0 flex-1 basis-auto flex-col">
            <span className={labelClass(prominent)}>{label}</span>{" "}
            <span className="truncate text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground">
              {sub}
            </span>
          </span>
        ) : (
          <span className={cn("flex-1 basis-auto", labelClass(prominent))}>{label}</span>
        )}
        {value != null && (
          <>
            {" "}
            <span className="min-w-0 text-body break-words text-muted-foreground">{value}</span>
          </>
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

const labelClass = (prominent?: boolean) =>
  cn("min-w-0 truncate", prominent ? "text-title-compact" : "text-body font-semibold");

// A destructive label sits alone in the middle of its row; a prominent row is taller.
const rowClass = ({ prominent, destructive }: RowProps, className?: string) =>
  cn(row, prominent && "min-h-18", destructive && "justify-center", className);

type AnchorRowProps = RowProps & Omit<ComponentProps<"a">, keyof RowProps>;

const RowAnchor = forwardRef<HTMLAnchorElement, AnchorRowProps>(function RowAnchor(
  { icon, leading, label, sub, value, trailing, prominent, destructive, className, ...rest },
  ref,
) {
  const props = { icon, leading, label, sub, value, trailing, prominent, destructive };
  return (
    <a ref={ref} {...rest} className={rowClass(props, className)}>
      <RowContent {...props} />
    </a>
  );
});

export const RowLink = createLink(RowAnchor);

export function RowButton({
  icon,
  leading,
  label,
  sub,
  value,
  trailing,
  prominent,
  destructive,
  className,
  type = "button",
  ...rest
}: RowProps & Omit<ComponentProps<"button">, keyof RowProps>) {
  const props = { icon, leading, label, sub, value, trailing, prominent, destructive };
  return (
    <button type={type} {...rest} className={rowClass(props, className)}>
      <RowContent {...props} />
    </button>
  );
}

// A row that only reads: no press tint, no focus. Its label and detail wrap rather than end in
// an ellipsis, since what it says (a refusal and its reason) must be read whole.
export function RowText({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex min-h-14 flex-col justify-center px-4 py-2">
      <span className="text-body font-semibold break-words">{label}</span>
      {detail && (
        <>
          {" "}
          <span className="text-(length:--text-secondary) leading-(--text-secondary--line-height) break-words text-muted-foreground">
            {detail}
          </span>
        </>
      )}
    </div>
  );
}

// One card of rows under an optional section label; each child is one row. The footer, under
// the card, is read as the list's description.
export function GroupedList({
  label,
  footer,
  children,
}: {
  label?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const footerId = useId();
  return (
    <section aria-labelledby={label ? id : undefined} className="flex flex-col gap-2">
      {label && (
        <h2 id={id} className={sectionLabel}>
          {label}
        </h2>
      )}
      <ul
        aria-labelledby={label ? id : undefined}
        aria-describedby={footer ? footerId : undefined}
        className={groupCard}
      >
        {Children.map(children, (child) => (child == null ? null : <li>{child}</li>))}
      </ul>
      {footer && (
        <p
          id={footerId}
          className="px-4 text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground"
        >
          {footer}
        </p>
      )}
    </section>
  );
}

// The kit's empty list: read from the left like the rows it stands in for, drawn by its caller
// inside a grouped card.
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
    <div className="flex flex-col items-start gap-3 p-4 text-left">
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
