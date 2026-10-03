import { RadioGroup } from "radix-ui";
import { type ReactNode, useId } from "react";

export type ChoiceListOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  aside?: string;
};

// A list of radio rows for more than three options, or options that need a description.
// `value` null means none is selected (the projection's fine-tuned pace).
export function ChoiceList<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: T | null;
  options: readonly ChoiceListOption<T>[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-[13px] font-semibold">
        {label} {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      </span>
      <RadioGroup.Root
        aria-labelledby={id}
        value={value ?? ""}
        onValueChange={(v) => onChange(v as T)}
        className="overflow-hidden rounded-field border border-input bg-card"
      >
        {options.map((o) => (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            className="group flex min-h-[46px] w-full items-center gap-2.5 border-t border-border px-3 py-1.5 text-left first:border-t-0 data-[state=checked]:bg-primary-soft"
          >
            <span
              aria-hidden
              className="size-[18px] shrink-0 rounded-full border-2 border-input group-data-[state=checked]:border-[5px] group-data-[state=checked]:border-primary"
            />
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold">{o.label}</span>
              {o.description && (
                <span className="text-xs leading-snug text-muted-foreground">{o.description}</span>
              )}
            </span>
            {o.aside && (
              <span className="ml-auto shrink-0 text-[13px] text-muted-foreground tabular-nums">
                {o.aside}
              </span>
            )}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
