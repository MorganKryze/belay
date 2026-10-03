import { RadioGroup } from "radix-ui";
import { useId } from "react";

export type ChoiceOption<T extends string> = { value: T; label: string };
// D11: two or three options of one word each. Beyond that, use ChoiceList.
export type SegmentedOptions<T extends string> =
  | readonly [ChoiceOption<T>, ChoiceOption<T>]
  | readonly [ChoiceOption<T>, ChoiceOption<T>, ChoiceOption<T>];

export function Segmented<T extends string>({
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
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-[13px] font-semibold">
        {label}
      </span>
      <RadioGroup.Root
        aria-labelledby={id}
        value={value}
        onValueChange={(v) => onChange(v as T)}
        orientation="horizontal"
        className="grid auto-cols-fr grid-flow-col gap-[3px] rounded-[12px] bg-track p-[3px]"
      >
        {options.map((o) => (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            className="min-h-11 rounded-[9px] px-1 text-[13px] font-semibold whitespace-nowrap text-muted-foreground data-[state=checked]:bg-card data-[state=checked]:text-foreground data-[state=checked]:shadow-xs"
          >
            {o.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
