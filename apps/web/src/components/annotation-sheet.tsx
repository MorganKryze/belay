import "@/i18n/lazy";
import { newId } from "@belay/shared";
import { ANNOTATION_LABEL_MAX, type AnnotationKind } from "@belay/shared/body/annotations";
import type { ISODate } from "@belay/shared/body/dates";
import type { AnnotationRow } from "@belay/shared/sync/schema";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { DayChip } from "./day-chip";
import { Segmented } from "./segmented";
import { Sheet } from "./sheet";
import { Button } from "./ui/button";
import type { Entry } from "./weigh-in";

// The annotation sheet (§4.2): a deload week, a diet break or a free note, on one day, with an
// optional text. An existing annotation reopens here, with Delete.
export function AnnotationSheet({
  onClose,
  annotation,
  today,
  onWrite,
  error,
}: {
  onClose: () => void;
  annotation: AnnotationRow | null; // null: a new one
  today: ISODate;
  onWrite: (entries: Entry[], previous: Entry[], deleted: boolean) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState(annotation?.date ?? today);
  const [type, setType] = useState<AnnotationKind>(annotation?.type ?? "deload");
  const [label, setLabel] = useState(annotation?.label ?? "");
  const labelId = useId();
  const [id] = useState(() => annotation?.id ?? newId());
  const block = (a: { date: ISODate; type: AnnotationKind; label: string | null }): Entry => ({
    kind: "annotation",
    id,
    field: "fields",
    ...a,
  });
  return (
    <Sheet
      title={t(annotation ? "annotation.title" : "annotation.titleNew")}
      onClose={onClose}
      chip={<DayChip date={date} today={today} onChange={setDate} label={t("annotation.date")} />}
    >
      <div className="flex flex-col gap-1.5">
        <Segmented
          label={t("annotation.type")}
          labelHidden
          value={type}
          onChange={setType}
          options={[
            { value: "deload", label: t("annotation.kinds.deload") },
            { value: "diet_break", label: t("annotation.kinds.diet_break") },
            { value: "note", label: t("annotation.kinds.note") },
          ]}
        />
        <p className="text-[13px] text-muted-foreground">{t("annotation.legend")}</p>
      </div>
      <label htmlFor={labelId} className="sr-only">
        {t("annotation.label")}
      </label>
      <input
        id={labelId}
        value={label}
        maxLength={ANNOTATION_LABEL_MAX}
        placeholder={t("annotation.placeholder")}
        autoComplete="off"
        className="min-h-12 w-full min-w-0 rounded-field border border-input bg-card px-4 text-base outline-offset-2"
        onChange={(e) => setLabel(e.target.value.replace(/[\r\n]/g, " "))}
      />
      <Button
        className="h-12 rounded-field text-base font-semibold"
        onClick={() =>
          onWrite(
            [block({ date, type, label: label.trim() === "" ? null : label.trim() })],
            annotation
              ? [block({ date: annotation.date, type: annotation.type, label: annotation.label })]
              : [{ kind: "annotation", id, field: "removed", value: true }],
            false,
          )
        }
      >
        {t(annotation ? "weighIn.save" : "annotation.add")}
      </Button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {annotation ? (
        <Button
          variant="outline"
          className="h-12 rounded-field text-base font-semibold"
          onClick={() =>
            onWrite(
              [{ kind: "annotation", id, field: "removed", value: true }],
              [{ kind: "annotation", id, field: "removed", value: false }],
              true,
            )
          }
        >
          {t("annotation.delete")}
        </Button>
      ) : (
        <p className="text-[13px] text-muted-foreground">{t("annotation.creatineNote")}</p>
      )}
    </Sheet>
  );
}
