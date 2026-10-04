import { RadioGroup } from "radix-ui";
import { useId } from "react";
import type { SegmentedOptions } from "./segmented";

// A compact Segmented on one line, label on the left (the female/male formula choice).
export function InlineChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SegmentedOptions<T>;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border">
      <span id={id} className="text-sm font-semibold">
        {label}
      </span>
      <RadioGroup.Root
        aria-labelledby={id}
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
}
