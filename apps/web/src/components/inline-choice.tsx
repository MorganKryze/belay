import { RadioGroup } from "radix-ui";
import { type ReactNode, useId } from "react";
import type { SegmentedOptions } from "./segmented";

// A compact Segmented on one line, label on the left (the female/male formula choice).
export function InlineChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: SegmentedOptions<T>;
  onChange: (value: T) => void;
  hint?: ReactNode; // a line under the choice that describes it
}) {
  const id = useId();
  const row = (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border">
      <span id={id} className="text-sm font-semibold">
        {label}
      </span>
      <RadioGroup.Root
        aria-labelledby={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        value={value}
        onValueChange={(v) => onChange(v as T)}
        orientation="horizontal"
        className="flex gap-[3px] rounded-chip bg-track p-[3px]"
      >
        {options.map((o) => (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            className="min-h-11 min-w-11 rounded-[8px] px-3 text-sm font-semibold text-muted-foreground data-[state=checked]:bg-card data-[state=checked]:text-foreground data-[state=checked]:shadow-xs"
          >
            {o.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
  if (!hint) return row;
  return (
    <div className="flex flex-col gap-1">
      {row}
      <div id={`${id}-hint`}>{hint}</div>
    </div>
  );
}
