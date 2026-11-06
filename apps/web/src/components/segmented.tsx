import { RadioGroup } from "radix-ui";
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { haptic } from "@/lib/haptic";

export type ChoiceOption<T extends string> = { value: T; label: string };
// Two or three options of one word each. Beyond that, use ChoiceList.
export type SegmentedOptions<T extends string> =
  | readonly [ChoiceOption<T>, ChoiceOption<T>]
  | readonly [ChoiceOption<T>, ChoiceOption<T>, ChoiceOption<T>];

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  labelHidden = false,
  hint,
}: {
  label: string;
  value: T | null; // null: nothing chosen yet
  options: SegmentedOptions<T>;
  onChange: (value: T) => void;
  // For screen readers only, where the options say it all (the period of the Body chart).
  labelHidden?: boolean;
  // A muted aside after the label, read as part of the group's name.
  hint?: string;
}) {
  const id = useId();
  const index = options.findIndex((o) => o.value === value);
  // The type step by its length: plain `text-secondary` names the secondary colour token first.
  const type = "text-(length:--text-secondary) leading-(--text-secondary--line-height)";
  // At the largest text sizes a word can outgrow its third of the groove: the options then stack,
  // one per row, rather than run into each other. Each label's own width is measured, so the
  // choice holds whichever way they are laid out. Measuring lays the page out, so the thumb waits
  // for the first measure (null until then): drawn before it, it would slide to its row on open.
  const groove = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState<boolean | null>(null);
  // Other values render other labels, the old ones leaving the page: they are watched afresh.
  const values = options.map((o) => o.value).join("\n");
  useLayoutEffect(() => {
    const root = groove.current;
    if (!root) return;
    // A browser without the observer keeps the options side by side.
    if (typeof ResizeObserver === "undefined") {
      setStacked(false);
      return;
    }
    const labels = [...root.querySelectorAll<HTMLElement>("[data-slot=segmented-label]")];
    const measure = () => {
      // 3 px of padding each side and between columns, 4 px of padding inside each option.
      const column = (root.clientWidth - 6 - (labels.length - 1) * 3) / labels.length - 8;
      setStacked(labels.some((label) => label.offsetWidth > column));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const label of labels) observer.observe(label);
    return () => observer.disconnect();
  }, [values]);
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className={labelHidden ? "sr-only" : `${type} font-semibold`}>
        {label}
        {hint && (
          <>
            {" "}
            <span className="font-normal text-muted-foreground">{hint}</span>
          </>
        )}
      </span>
      {/* The ring is marked important: the group sets an inline `outline: none` that would
          otherwise hide it, and the items drop their own so the whole groove rings once. After a tap
          it shows none, as every other ring (html[data-pointer] in index.css). */}
      <RadioGroup.Root
        ref={groove}
        aria-labelledby={id}
        value={value ?? ""}
        onValueChange={(v) => {
          haptic("selection");
          onChange(v as T);
        }}
        orientation={stacked ? "vertical" : "horizontal"}
        data-stacked={stacked || undefined}
        className="relative grid auto-cols-fr auto-rows-fr grid-flow-col gap-[3px] data-stacked:grid-flow-row rounded-control bg-track p-[3px] [html:not([data-pointer])_&]:has-[:focus-visible]:outline-2! [html:not([data-pointer])_&]:has-[:focus-visible]:outline-offset-2 [html:not([data-pointer])_&]:has-[:focus-visible]:outline-ring!"
      >
        {index >= 0 && stacked !== null && (
          // One thumb slides between options; its width is one column of the groove (3 px padding
          // each side, 3 px between columns), and each step moves it one column plus one gap.
          // Stacked, the same along the rows.
          <span
            aria-hidden="true"
            data-slot="segmented-thumb"
            style={{ "--seg-i": index, "--seg-n": options.length } as CSSProperties}
            className={`pointer-events-none absolute top-[3px] left-[3px] ${
              stacked
                ? "right-[3px] h-[calc((100%-6px-(var(--seg-n)-1)*3px)/var(--seg-n))] translate-y-[calc(var(--seg-i)*(100%+3px))]"
                : "bottom-[3px] w-[calc((100%-6px-(var(--seg-n)-1)*3px)/var(--seg-n))] translate-x-[calc(var(--seg-i)*(100%+3px))]"
            } rounded-[calc(var(--radius-control)-3px)] bg-surface shadow-xs transition-transform duration-(--slide-duration) ease-nav`}
          />
        )}
        {options.map((o) => (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            className={`relative min-h-11 px-1 ${type} whitespace-nowrap focus-visible:outline-none ${
              o.value === value
                ? "font-bold text-foreground"
                : "font-semibold text-muted-foreground"
            }`}
          >
            <span data-slot="segmented-label" className="inline-block">
              {o.label}
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
