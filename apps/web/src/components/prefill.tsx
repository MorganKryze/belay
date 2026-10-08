import "@/i18n/lazy";
import { isProfileHeight, type Profile } from "@belay/shared/body/profile";
import {
  type Source,
  type ToolDefaults,
  toolDefaults,
  type ToolField,
} from "@belay/shared/body/tool-defaults";
import type { ProfileChange } from "@belay/shared/sync/schema";
import type { Formula } from "@belay/shared/tools/catalog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { formatWeekday } from "@/lib/format";
import { useToday } from "@/lib/today";
import { useAccount } from "@/sync/account";
import { readMeasures, readProfile, readWeights, recordChange } from "@/sync/db";
import { Button } from "./ui/button";

// The profile facts a tool may offer to update (D9): the formula and the height, never the age
// or the weight, which stay a calculation.
type ProfileField = "formula" | "heightCm";

type Proposal = { profile: unknown; value: unknown; accept: () => void; decline: () => void };

// A connected tool opens from the profile and the tracking (§4.5): each prefilled field says
// where its value comes from until the person changes it; "Back to my last entries" returns to
// the device's values (M1). Signed out, or with nothing to offer, the tool is as in M1.
export function usePrefill(fields: readonly ToolField[]) {
  const account = useAccount();
  const today = useToday();
  const open = account.kind === "open" ? account : null;
  const queryClient = useQueryClient();
  // Read once, when the tool opens: what the person then types never moves under them.
  const defaults = useQuery({
    queryKey: ["prefill", open?.user.id, today],
    queryFn: async (): Promise<ToolDefaults> => {
      const db = open!.db;
      const [profile, weighings, measures] = await Promise.all([
        readProfile(db),
        readWeights(db),
        readMeasures(db),
      ]);
      return toolDefaults({ profile, weighings, measures, today });
    },
    enabled: open !== null,
    networkMode: "always",
    staleTime: Infinity,
    gcTime: 0,
  }).data;
  // The profile as it is now, to offer an update only while the tool's value differs from it.
  const profile = useQuery({
    queryKey: ["local", open?.user.id, "profile"],
    queryFn: () => readProfile(open!.db),
    enabled: open !== null,
    networkMode: "always",
  }).data;
  const [dropped, setDropped] = useState<ReadonlySet<ToolField> | "all">(new Set());
  const [edited, setEdited] = useState<ReadonlySet<ProfileField>>(new Set());
  const [declined, setDeclined] = useState<Partial<Record<ProfileField, unknown>>>({});

  const get = <F extends ToolField>(field: F): ToolDefaults[F] | undefined =>
    dropped === "all" || dropped.has(field) || !fields.includes(field)
      ? undefined
      : defaults?.[field];
  return {
    get,
    // The prefilled value while there is one, else the device's.
    value<V>(field: ToolField, device: V): V {
      return (get(field)?.value as V | undefined) ?? device;
    },
    // The person changed the field: its value is theirs from now on (and on the device).
    edit(field: ToolField) {
      setDropped((d) => (d === "all" ? d : new Set([...d, field])));
      if (field === "formula" || field === "heightCm") setEdited((e) => new Set([...e, field]));
    },
    // Some field still shows a prefilled value.
    any: fields.some((f) => get(f) !== undefined),
    restore: () => setDropped("all"),
    // The update to offer under a profile field the person changed, or null.
    proposal(field: ProfileField, current: Formula | number): Proposal | null {
      const held = profile?.[field as keyof Profile] ?? null;
      const valid = field === "formula" || isProfileHeight(current as number);
      if (!open || !edited.has(field) || !valid || held === null || held === current) return null;
      if (declined[field] === current) return null;
      const at = new Date().toISOString();
      const change: ProfileChange =
        field === "formula"
          ? { kind: "profile", field: "formula", value: current as Formula, at }
          : { kind: "profile", field: "height", value: current as number, at };
      return {
        profile: held,
        value: current,
        accept: () =>
          void recordChange(open.db, change).then(() => {
            open.engine.schedule();
            return queryClient.invalidateQueries({ queryKey: ["local", open.user.id] });
          }),
        decline: () => setDeclined((d) => ({ ...d, [field]: current })),
      };
    },
  };
}

// Under a prefilled field: where its value comes from.
export function SourceLine({ source }: { source: Source | undefined }) {
  const { t, i18n } = useTranslation();
  const today = useToday();
  if (!source) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <i aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
      {source.from === "measures"
        ? t("prefill.from.measures", {
            day: formatWeekday(source.date, i18n.language, today, { startOfLine: false }),
          })
        : t(`prefill.from.${source.from}`)}
    </p>
  );
}

// Under a changed formula or height: update the profile with it, or keep it for this tool only.
export function ProfileProposal({
  proposal,
  show,
}: {
  proposal: Proposal | null;
  show: (value: unknown) => string;
}) {
  const { t } = useTranslation();
  if (!proposal) return null;
  return (
    <div
      role="group"
      aria-label={t("prefill.proposalLabel")}
      className="flex flex-col gap-2 rounded-field bg-primary-soft p-3 text-sm"
    >
      <p>
        <Trans
          i18nKey="prefill.proposal"
          values={{ profile: show(proposal.profile), value: show(proposal.value) }}
          components={{ b: <b /> }}
        />
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={proposal.accept}>{t("prefill.update")}</Button>
        <Button variant="outline" onClick={proposal.decline}>
          {t("prefill.justHere")}
        </Button>
      </div>
    </div>
  );
}

// Back to the values entered on this device (M1), shown while a field is still prefilled.
export function RestoreButton({ prefill }: { prefill: { any: boolean; restore: () => void } }) {
  const { t } = useTranslation();
  if (!prefill.any) return null;
  return (
    <button
      type="button"
      className="-mt-2 inline-flex min-h-11 items-center gap-1 self-end text-sm font-semibold text-primary"
      onClick={prefill.restore}
    >
      <RotateCcw aria-hidden className="size-4" />
      {t("prefill.restore")}
    </button>
  );
}
