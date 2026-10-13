import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

// The sentence under a field in error. The field carries aria-invalid and aria-describedby={id};
// the alert is told by its icon and words, never by red.
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-secondary text-foreground">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-primary-ink" />
      {children}
    </p>
  );
}
