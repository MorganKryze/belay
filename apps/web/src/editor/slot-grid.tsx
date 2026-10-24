import { exerciseById } from "@belay/shared/exercises/catalog";
import type { ProgramSlot } from "@belay/shared/training/stored-program";
import { Check, Link2, Mountain } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LoopThumb } from "@/components/loop-thumb";
import { BodyThumb } from "@/exercises/body-map";
import { readRestStyle, readThumbs } from "@/lib/editor-prefs";
import { formatRange, formatRest } from "@/workouts/format";
import { type PlacedSession, titleOf } from "./editor-context";

// The eight columns: the exercise takes what the fixed value columns leave. The table keeps a
// minimum width, so a narrow window scrolls it inside its card.
const COLUMNS =
  "grid min-w-3xl grid-cols-[minmax(12rem,1fr)_4.25rem_5.25rem_4.25rem_6rem_4.5rem_4.75rem_2.75rem] items-center gap-x-1.5 pr-2.5 pl-4";
const COLUMN_KEYS = ["exercise", "sets", "reps", "rir", "rest", "warmups", "main", "actions"];
const value = "grid h-11 place-items-center rounded-chip bg-track font-semibold whitespace-nowrap";
const line = "col-span-full flex items-center gap-2 text-section text-muted-foreground";

// Where a slot sits in its group: chained slots share a group key with a neighbour; only the last
// of a group rests, the others go straight to the next exercise.
function groupPlace(slots: readonly ProgramSlot[], i: number) {
  const key = slots[i]!.groupKey;
  if (key === null) return { grouped: false, first: false, last: false };
  const before = slots[i - 1]?.groupKey === key;
  const after = slots[i + 1]?.groupKey === key;
  return { grouped: before || after, first: !before && after, last: before && !after };
}

// « 2:30 », the way a clock writes the rest, for those who read it so.
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

// The shown session's slots as a table, read only: one row per slot, the chained groups announced
// by a line and a rule on their left, the slots of the weeks with no climbing in their own section.
export function SlotGrid({ placed }: { placed: PlacedSession }) {
  const { t } = useTranslation();
  return (
    <div
      role="table"
      aria-label={t("editor.grid.label", { session: titleOf(placed, t) })}
      className="tabular-nums"
    >
      <div role="rowgroup">
        <div role="row" className={`${COLUMNS} min-h-8.5 border-t border-border`}>
          {COLUMN_KEYS.map((key, i) => (
            <span
              key={key}
              role="columnheader"
              className={`text-section text-muted-foreground ${i === 0 ? "text-left" : "text-center"}`}
            >
              {key === "actions" ? (
                <span className="sr-only">{t("editor.col.actions")}</span>
              ) : (
                t(`editor.col.${key}`)
              )}
            </span>
          ))}
        </div>
      </div>
      <Rows slots={placed.slots} />
      {placed.noClimbing.length > 0 && (
        <div role="rowgroup" aria-label={t("editor.grid.noClimbing")}>
          <div role="row" className="grid min-w-3xl">
            <span
              role="cell"
              className={`${line} min-h-11 border-t border-border px-4 pt-2.5 pb-1.5`}
            >
              <Mountain aria-hidden className="size-4" />
              {t("editor.grid.noClimbing")}
            </span>
          </div>
          <Rows slots={placed.noClimbing} />
        </div>
      )}
    </div>
  );
}

function Rows({ slots }: { slots: readonly ProgramSlot[] }) {
  const { t } = useTranslation();
  return (
    <div role="rowgroup">
      {slots.flatMap((slot, i) => {
        const place = groupPlace(slots, i);
        const row = (
          <SlotRow
            key={slot.id}
            slot={slot}
            grouped={place.grouped}
            rests={!place.grouped || place.last}
          />
        );
        if (!place.first) return [row];
        return [
          <div key={`${slot.id}-group`} role="row" className="grid min-w-3xl">
            <span role="cell" className={`${line} min-h-8.5 pt-2 pl-4`}>
              <Link2 aria-hidden className="size-4" />
              {t("editor.grid.group")}
            </span>
          </div>,
          row,
        ];
      })}
    </div>
  );
}

function SlotRow({
  slot,
  grouped,
  rests,
}: {
  slot: ProgramSlot;
  grouped: boolean;
  rests: boolean;
}) {
  const { t } = useTranslation();
  const exercise = exerciseById(slot.exerciseId);
  const range = formatRange(slot.repRange);
  return (
    <div
      role="row"
      className={`${COLUMNS} relative min-h-15 border-t border-border ${
        grouped
          ? "before:absolute before:inset-y-0 before:left-1.5 before:w-0.5 before:rounded-full before:bg-muted-foreground"
          : ""
      }`}
    >
      <span role="cell" className="flex min-w-0 items-center gap-3 py-2">
        {exercise && readThumbs() === "shown" && (
          <LoopThumb
            exerciseId={exercise.id}
            fallback={<BodyThumb primary={exercise.primary[0]!} secondary={exercise.secondary} />}
          />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body font-semibold">
            {exercise?.name ?? slot.exerciseId}
          </span>
          {exercise && (
            <span className="truncate text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground">
              {t("editor.grid.sub", {
                muscle: t(`library.muscles.${exercise.primary[0]}`),
                equipment: t(`library.equipment.${exercise.equipment}`),
              })}
            </span>
          )}
        </span>
      </span>
      <span role="cell" className={value}>
        {slot.sets}
      </span>
      <span role="cell" className={value}>
        {slot.measure === "seconds" ? t("editor.grid.seconds", { range }) : range}
      </span>
      <span role="cell" className={value}>
        {formatRange(slot.rirTarget)}
      </span>
      {rests ? (
        <span role="cell" className={value}>
          {readRestStyle() === "clock" ? clock(slot.restSec) : formatRest(slot.restSec, t)}
        </span>
      ) : (
        <span
          role="cell"
          className="grid h-11 place-items-center font-medium text-muted-foreground"
        >
          {t("editor.grid.noRest")}
        </span>
      )}
      <span role="cell" className={value}>
        {slot.warmupSets}
      </span>
      <span role="cell" className="grid place-items-center">
        <span
          className={`grid size-5.5 place-items-center rounded-icon ${
            slot.isMain
              ? "bg-primary text-primary-foreground"
              : "ring-[1.5px] ring-input ring-inset"
          }`}
        >
          {slot.isMain && <Check aria-hidden className="size-4" strokeWidth={3} />}
        </span>
        <span className="sr-only">
          {t(slot.isMain ? "editor.grid.main" : "editor.grid.notMain")}
        </span>
      </span>
      <span role="cell" />
    </div>
  );
}
