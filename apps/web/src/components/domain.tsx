import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type Domain = "session" | "body" | "activity" | "intake" | "rest";

// Written out whole, so the stylesheet keeps each class: a tint to sit on, a shade for the words
// and the icon.
const COLOURS: Record<Domain, string> = {
  session: "bg-session-tint text-session-shade",
  body: "bg-body-tint text-body-shade",
  activity: "bg-activity-tint text-activity-shade",
  intake: "bg-intake-tint text-intake-shade",
  rest: "bg-rest-tint text-rest-shade",
};

// A domain named by its words and its icon on the domain's tint. A label, never a control: it
// lives inside cards and rows and takes no focus of its own.
export function DomainChip({
  domain,
  icon: Icon,
  children,
}: {
  domain: Domain;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      data-accent={domain}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-(length:--text-secondary) font-semibold whitespace-nowrap ${COLOURS[domain]}`}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

// A row's icon on its domain's tint; the row's own words name it, so the tile stays silent.
export function DomainTile({ domain, icon: Icon }: { domain: Domain; icon: LucideIcon }) {
  return (
    <span
      aria-hidden="true"
      data-accent={domain}
      className={`grid size-7 shrink-0 place-items-center rounded-icon ${COLOURS[domain]}`}
    >
      <Icon className="size-4" />
    </span>
  );
}
