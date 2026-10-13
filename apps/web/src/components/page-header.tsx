import { createLink } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type ComponentProps, forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// The screen's title: a large h1 that fades as the page scrolls under a frosted bar, whose compact
// copy of the title fades in over the same 44 px (the fold rules live in index.css). Only opacity
// moves, so nothing on the page shifts.
export function PageHeader({
  title,
  back,
  trailing,
  focusFallback,
  children,
}: {
  title: string;
  back?: ReactNode;
  trailing?: ReactNode;
  focusFallback?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      {/* Bleeds over the layout's side padding so the glass spans the screen; the negative bottom
          margin takes back most of the 16 px gap the screens put between blocks, so the large
          title sits 2 px under the bar. */}
      <div className="sticky top-(--header-top) z-20 -mb-3.5 mr-[calc(-1*max(1rem,env(safe-area-inset-right)))] ml-[calc(-1*max(1rem,env(safe-area-inset-left)))] pt-[env(safe-area-inset-top)]">
        <div aria-hidden className="absolute inset-0 glass border-b border-border fold-in" />
        {/* An invisible copy of the back link holds the right column at the same width, so the
            compact title stays centred and truncates before it reaches the back label. */}
        <div className="relative grid h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-1.5">
          <div>{back}</div>
          <p
            data-compact-title
            aria-hidden
            className="truncate text-center text-title-compact fold-in"
          >
            {title}
          </p>
          <div aria-hidden inert className="invisible">
            {back}
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-3">
          <h1
            {...(focusFallback && { tabIndex: -1, "data-focus-fallback": true })}
            className={cn("text-title-lg fold-out", focusFallback && "outline-none")}
          >
            {title}
          </h1>
          {trailing}
        </div>
        {children}
      </div>
    </>
  );
}

const BackAnchor = forwardRef<HTMLAnchorElement, ComponentProps<"a">>(function BackAnchor(
  { children, className, ...rest },
  ref,
) {
  return (
    <a
      ref={ref}
      {...rest}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center font-medium text-primary",
        className,
      )}
    >
      <ChevronLeft aria-hidden className="size-6 shrink-0" />
      {children}
    </a>
  );
});

export const BackLink = createLink(BackAnchor);
