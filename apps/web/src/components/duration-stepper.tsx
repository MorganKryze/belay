import { Minus, Plus } from "lucide-react";
import { type KeyboardEvent, useId } from "react";
import { useTranslation } from "react-i18next";
import { formatMinutes } from "@/lib/activities";

// A duration in steps of 5 minutes, shown as it is said ("1 h 30"): − and +, or the arrow keys
// on the value itself (a spin button). Nothing to type: one tap is 5 minutes.
export function DurationStepper({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (minutes: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  const nudge = (direction: 1 | -1) =>
    onChange(Math.min(max, Math.max(min, value + direction * step)));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    nudge(e.key === "ArrowUp" ? 1 : -1);
  };
  const button =
    "grid size-12 shrink-0 place-items-center text-primary aria-disabled:text-muted-foreground aria-disabled:opacity-60";
  const text = formatMinutes(value, t);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={id} className="text-[13px] font-semibold">
        {label}
      </span>
      <div className="field flex h-12.5 items-center">
        <button
          type="button"
          className={button}
          aria-label={t("stepper.decrease", { label })}
          aria-disabled={value <= min}
          onClick={() => value > min && nudge(-1)}
        >
          <Minus aria-hidden className="size-5" />
        </button>
        <div
          role="spinbutton"
          tabIndex={0}
          aria-labelledby={id}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={text}
          onKeyDown={onKeyDown}
          className="flex-1 text-center text-xl font-bold tabular-nums outline-none"
        >
          {text}
        </div>
        <button
          type="button"
          className={button}
          aria-label={t("stepper.increase", { label })}
          aria-disabled={value >= max}
          onClick={() => value < max && nudge(1)}
        >
          <Plus aria-hidden className="size-5" />
        </button>
      </div>
    </div>
  );
}
