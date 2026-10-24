import { Check } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cardSurface } from "./surfaces";

// A session's title (17 px) over one muted line, led by where it stands (« La prochaine »,
// « En cours ») in the accent ink.
export function SessionHeading({
  id,
  title,
  lead,
  detail,
}: {
  id: string;
  title: string;
  lead?: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col">
      <h2 id={id} className="text-[17px] font-semibold">
        {title}
      </h2>
      {/* The space keeps the title and this line apart when read as one name. */}{" "}
      <p className="text-[13px] text-muted-foreground">
        {lead && <span className="font-semibold text-primary-ink">{lead} · </span>}
        {detail}
      </p>
    </div>
  );
}

// A session as a card of its own: a region named by its title, then its action. A session done
// shows the reference tile with a check before its title.
export function SessionCard({
  title,
  lead,
  detail,
  done = false,
  children,
}: {
  title: string;
  lead?: string;
  detail: string;
  done?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  const heading = <SessionHeading id={id} title={title} lead={lead} detail={detail} />;
  return (
    <section aria-labelledby={id} className={`${cardSurface} flex flex-col gap-3 px-4 py-3`}>
      {done ? (
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-reference text-reference-ink">
            <Check className="size-5" aria-hidden="true" />
          </span>
          {heading}
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  );
}
