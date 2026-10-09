import { roundTo } from "@belay/shared/tools/round";
import { Minus, Plus } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { decimalsOf, formatNumber, parseDecimal } from "@/lib/format";

export type NumberStepperProps = {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  // Empty is a valid answer (body fat in the protein tool): blur on an empty field gives null.
  optional?: boolean;
  // − / + buttons; off where three fields share a row and typing is the faster path.
  buttons?: boolean;
  error?: string;
  // The label for screen readers only, where a card title already says what the field is.
  labelHidden?: boolean;
  // false: a typed value outside [min, max] is handed over as is when the field is left, for
  // the caller to refuse, instead of being clamped (a weight typed "798" must not become 400).
  clampTyped?: boolean;
  // true: − and + do nothing while the field is empty (no value is invented from a bound).
  inertWhenEmpty?: boolean;
  // A line under the field that describes it (where a prefilled value comes from).
  hint?: ReactNode;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function NumberStepper({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  optional = false,
  buttons = true,
  error,
  labelHidden = false,
  clampTyped = true,
  inertWhenEmpty = false,
  hint,
}: NumberStepperProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const show = (v: number | null) =>
    v === null ? "" : formatNumber(v, i18n.language, { digits: decimalsOf(step), grouping: false });
  // What the person is typing; null while the field shows the committed value.
  const [draft, setDraft] = useState<string | null>(null);

  const inert = inertWhenEmpty && value === null;
  const atMin = inert || (value !== null && value <= min);
  const atMax = inert || (value !== null && value >= max);

  const nudge = (direction: 1 | -1) => {
    if (inert) return;
    const next = clamp(roundTo((value ?? min) + direction * step, step), min, max);
    setDraft(null);
    onChange(next);
  };

  const type = (text: string) => {
    setDraft(text);
    const parsed = parseDecimal(text);
    if (clampTyped) {
      // Live while the number is valid, so the result follows the typing.
      if (parsed !== null && parsed >= min && parsed <= max) onChange(parsed);
    } else if (parsed !== null) onChange(parsed);
    // Unclamped: what is shown is the value, in range or not, so the caller never acts on a
    // stale one (a tap on Save may not blur the field). Text that is no number is NaN, which
    // the caller refuses; an empty optional field is null.
    else onChange(text.trim() === "" && optional ? null : Number.NaN);
  };

  const commit = () => {
    if (draft === null) return;
    const parsed = parseDecimal(draft);
    setDraft(null);
    if (draft.trim() === "" && optional) onChange(null);
    else if (parsed !== null) onChange(clampTyped ? clamp(parsed, min, max) : parsed);
    else if (!clampTyped) onChange(null); // text that is no number: the field is cleared
    // Anything else: the field goes back to the last valid value.
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      nudge(e.key === "ArrowUp" ? 1 : -1);
    } else if (e.key === "Enter") {
      commit();
    }
  };

  // aria-disabled, not disabled: the button keeps keyboard focus when it reaches a bound.
  const button =
    "grid size-12 shrink-0 place-items-center text-primary aria-disabled:text-muted-foreground aria-disabled:opacity-60";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelHidden ? "sr-only" : "text-[13px] font-semibold"}>
        {label}
      </label>
      <div
        className={cn(
          "flex h-[52px] items-center rounded-field border border-input bg-card has-[input:focus]:outline-2 has-[input:focus]:outline-offset-2",
          error && "border-2 border-primary",
        )}
      >
        {buttons && (
          <button
            type="button"
            className={button}
            aria-label={t("stepper.decrease", { label })}
            aria-disabled={atMin}
            onClick={() => !atMin && nudge(-1)}
          >
            <Minus aria-hidden className="size-5" />
          </button>
        )}
        {/* The whole box is the tap target: the input itself is shorter than the 52 px box. */}
        <div
          className="flex min-w-0 flex-1 cursor-text items-baseline justify-center gap-0.5 self-stretch px-1 pt-3"
          onPointerDown={(e) => {
            if (e.target === inputRef.current) return;
            e.preventDefault(); // keeps focus from blurring, then lands it in the field
            inputRef.current?.focus();
          }}
        >
          <input
            ref={inputRef}
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={draft ?? show(value)}
            onChange={(e) => type(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              [unit && `${id}-unit`, error && `${id}-error`, hint && `${id}-hint`]
                .filter(Boolean)
                .join(" ") || undefined
            }
            className={cn(
              "w-full min-w-0 flex-1 bg-transparent text-xl font-bold tabular-nums outline-none",
              unit ? "text-right" : "text-center",
            )}
          />
          {unit && (
            <span
              id={`${id}-unit`}
              className="flex-1 text-[13px] font-medium text-muted-foreground"
            >
              {unit}
            </span>
          )}
        </div>
        {buttons && (
          <button
            type="button"
            className={button}
            aria-label={t("stepper.increase", { label })}
            aria-disabled={atMax}
            onClick={() => !atMax && nudge(1)}
          >
            <Plus aria-hidden className="size-5" />
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-[13px] font-medium text-primary-ink">
          {error}
        </p>
      )}
      {hint && <div id={`${id}-hint`}>{hint}</div>}
    </div>
  );
}
