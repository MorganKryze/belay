import { RadioGroup } from "radix-ui";
import { useId, type CSSProperties } from "react";

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
  labelHidden = false,
}: {
  label: string;
  value: T | null; // null: nothing chosen yet
  options: SegmentedOptions<T>;
  onChange: (value: T) => void;
  // For screen readers only, where the options say it all (the period of the Body chart).
  labelHidden?: boolean;
}) {
  const id = useId();
  const index = options.findIndex((o) => o.value === value);
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className={labelHidden ? "sr-only" : "text-secondary font-semibold"}>
        {label}
      </span>
      <RadioGroup.Root
        aria-labelledby={id}
        value={value ?? ""}
        onValueChange={(v) => onChange(v as T)}
        orientation="horizontal"
        className="relative grid auto-cols-fr grid-flow-col gap-[3px] rounded-control bg-track p-[3px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
      >
        {index >= 0 && (
          // One thumb slides between options; its width is one column of the groove (3 px padding
          // each side, 3 px between columns), and each step moves it one column plus one gap.
          <span
            aria-hidden="true"
            data-slot="segmented-thumb"
            style={{ "--seg-i": index, "--seg-n": options.length } as CSSProperties}
            className="pointer-events-none absolute inset-y-[3px] left-[3px] w-[calc((100%-6px-(var(--seg-n)-1)*3px)/var(--seg-n))] translate-x-[calc(var(--seg-i)*(100%+3px))] rounded-[calc(var(--radius-control)-3px)] bg-surface shadow-xs transition-transform duration-(--slide-duration) ease-nav"
          />
        )}
        {options.map((o) => (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            className={`relative min-h-11 px-1 text-secondary whitespace-nowrap focus-visible:outline-none ${
              o.value === value
                ? "font-bold text-foreground"
                : "font-semibold text-muted-foreground"
            }`}
          >
            {o.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
