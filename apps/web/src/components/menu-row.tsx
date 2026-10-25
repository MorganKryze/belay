import type { LucideIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { RowButton } from "@/components/grouped-list";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";

export type MenuOption<T extends string> = { value: T; label: string; lang?: string };

// Radix hides the page behind an open menu with aria-hidden only, so its links stay focusable
// behind the menu. Marking the app's root inert takes them out of reach too.
const root = () => document.getElementById("root");

// A grouped row that shows its current value and opens an anchored menu of the choices; without
// an icon its label starts the row.
export function MenuRow<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon?: LucideIcon;
  label: string;
  value: T;
  options: readonly MenuOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? "";

  // Unmounted while open (a navigation): the page must not stay out of reach.
  useEffect(() => {
    if (!open) return;
    return () => root()?.removeAttribute("inert");
  }, [open]);

  return (
    <Select
      value={value}
      open={open}
      onOpenChange={(next) => {
        // Freed here, synchronously, before Radix gives the focus back to the row: an inert row
        // cannot take it.
        if (next) root()?.setAttribute("inert", "");
        else root()?.removeAttribute("inert");
        setOpen(next);
      }}
      onValueChange={(v) => onChange(v as T)}
    >
      {/* A combobox takes no name from its content: the row says its label and value itself. */}
      <SelectPrimitive.Trigger asChild>
        <RowButton
          aria-label={current ? `${label} · ${current}` : label}
          icon={icon}
          label={label}
          trailing="menu"
          value={<SelectValue />}
        />
      </SelectPrimitive.Trigger>
      <SelectContent position="popper" align="end">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} lang={o.lang}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
