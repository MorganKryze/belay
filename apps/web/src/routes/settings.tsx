import "@/i18n/lazy";
import { useMutation } from "@tanstack/react-query";
import {
  BellRing,
  CalendarDays,
  Check,
  CirclePause,
  Dumbbell,
  ImageIcon,
  Info,
  Keyboard,
  Languages,
  ListPlus,
  Pill,
  Scale,
  SunMoon,
  Timer,
  UserRound,
  Utensils,
  Weight,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toISODate } from "@belay/shared/body/dates";
import type { Change } from "@belay/shared/sync/schema";
import type { PauseStops } from "@belay/shared/training/pause";
import { BackLink, PageHeader } from "@/components/page-header";
import { initialOf } from "@/components/avatar";
import { ActionSheet } from "@/components/action-sheet";
import { GroupedList, RowButton, RowLink, RowText } from "@/components/grouped-list";
import { MenuRow } from "@/components/menu-row";
import { LOCALES, setLocale, type Locale } from "@/i18n";
import { logout } from "@/lib/api";
import {
  readBrzycki,
  readFieldSources,
  readHistoryActivities,
  readSessionVolume,
  readWeekIntake,
  setBrzycki,
  setFieldSources,
  setHistoryActivities,
  setSessionVolume,
  setWeekIntake,
  type Shown,
} from "@/lib/display-prefs";
import {
  type HomeTrend,
  readHomeTrend,
  readRangePill,
  setHomeTrend,
  setRangePill,
} from "@/lib/home-trend";
import {
  readAdded,
  readHelp,
  readRestStyle,
  readThumbs,
  setAdded,
  setHelp,
  setRestStyle,
  setThumbs,
} from "@/lib/editor-prefs";
import { readPauseStops, setPauseStops } from "@/lib/pause-stops";
import { previewRestSound, readRestSound, setRestSound, type RestSound } from "@/lib/rest-sound";
import { readTheme, setTheme, type Theme } from "@/lib/theme";
import { readWeightUnit, setWeightUnit, type WeightUnit } from "@/lib/units";
import { formatWeekday } from "@/lib/format";
import { useToday } from "@/lib/today";
import { APP_VERSION, releaseUrl } from "@/lib/version";
import type { LastUser } from "@/sync/last-user";
import {
  type OpenAccount,
  useAccount,
  useClearRejected,
  usePending,
  useRejected,
  useAnnotations,
  useSupplements,
} from "@/sync/account";

const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", fr: "Français" };
const THEMES = ["light", "dark", "system"] as const satisfies readonly Theme[];
const PAUSE_STOPS = ["all", "session"] as const satisfies readonly PauseStops[];
const WEIGHT_UNITS = ["kg", "lb"] as const satisfies readonly WeightUnit[];
const REST_SOUNDS = ["off", "on"] as const satisfies readonly RestSound[];
const SHOWN = ["shown", "hidden"] as const satisfies readonly Shown[];

export function Settings() {
  const { t, i18n } = useTranslation();
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [pauseStops, setPauseStopsState] = useState<PauseStops>(readPauseStops);
  const [weightUnit, setWeightUnitState] = useState<WeightUnit>(readWeightUnit);
  const [restSound, setRestSoundState] = useState<RestSound>(readRestSound);
  const [homeTrend, setHomeTrendState] = useState<HomeTrend>(readHomeTrend);
  const [rangePill, setRangePillState] = useState<HomeTrend>(readRangePill);
  const [weekIntake, setWeekIntakeState] = useState<Shown>(readWeekIntake);
  const [historyActivities, setHistoryActivitiesState] = useState<Shown>(readHistoryActivities);
  const [sessionVolume, setSessionVolumeState] = useState<Shown>(readSessionVolume);
  const [brzycki, setBrzyckiState] = useState<Shown>(readBrzycki);
  const [fieldSources, setFieldSourcesState] = useState<Shown>(readFieldSources);
  const account = useAccount();
  // The sections take the names of the screens their rows change.
  const general = t("settings.general");
  const home = t("nav.home");
  const sessions = t("nav.workouts");
  const body = t("nav.body");
  const tools = t("nav.tools");

  return (
    <section className="flex flex-1 flex-col gap-4">
      <PageHeader title={t("settings.title")} back={<BackLink to="/">{t("nav.home")}</BackLink>} />

      {"user" in account && <ProfileRow user={account.user} />}
      {account.kind === "open" && <RejectedEntries account={account} />}

      <GroupedList label={general}>
        <MenuRow
          icon={Languages}
          label={t("settings.language")}
          value={i18n.language as Locale}
          options={LOCALES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l], lang: l }))}
          onChange={setLocale}
        />
        <MenuRow
          icon={SunMoon}
          label={t("settings.theme")}
          value={theme}
          options={THEMES.map((th) => ({ value: th, label: t(`settings.themes.${th}`) }))}
          onChange={(th) => {
            setTheme(th);
            setThemeState(th);
          }}
        />
        <MenuRow
          icon={Weight}
          label={t("settings.weightUnit")}
          value={weightUnit}
          options={WEIGHT_UNITS.map((v) => ({
            value: v,
            label: t(`settings.weightUnitOptions.${v}`),
          }))}
          onChange={(v) => {
            setWeightUnit(v);
            setWeightUnitState(v);
          }}
        />
      </GroupedList>
      <GroupedList label={home}>
        <MenuRow
          icon={Scale}
          label={t("settings.homeTrend")}
          value={homeTrend}
          options={SHOWN.map((v) => ({
            value: v,
            label: t(`settings.homeTrendOptions.${v}`),
          }))}
          onChange={(v) => {
            setHomeTrend(v);
            setHomeTrendState(v);
          }}
        />
      </GroupedList>
      <GroupedList label={sessions}>
        <MenuRow
          icon={CirclePause}
          label={t("settings.pauseStops")}
          value={pauseStops}
          options={PAUSE_STOPS.map((v) => ({
            value: v,
            label: t(`settings.pauseStopsOptions.${v}`),
          }))}
          onChange={(v) => {
            setPauseStops(v);
            setPauseStopsState(v);
          }}
        />
        <MenuRow
          icon={BellRing}
          label={t("settings.restSound")}
          value={restSound}
          options={REST_SOUNDS.map((v) => ({
            value: v,
            label: t(`settings.restSoundOptions.${v}`),
          }))}
          onChange={(v) => {
            setRestSound(v);
            setRestSoundState(v);
            if (v === "on") previewRestSound();
          }}
        />
        <MenuRow
          icon={CalendarDays}
          label={t("settings.historyActivities")}
          value={historyActivities}
          options={SHOWN.map((v) => ({
            value: v,
            label: t(`settings.historyActivitiesOptions.${v}`),
          }))}
          onChange={(v) => {
            setHistoryActivities(v);
            setHistoryActivitiesState(v);
          }}
        />
        <MenuRow
          icon={Dumbbell}
          label={t("settings.sessionVolume")}
          value={sessionVolume}
          options={SHOWN.map((v) => ({
            value: v,
            label: t(`settings.sessionVolumeOptions.${v}`),
          }))}
          onChange={(v) => {
            setSessionVolume(v);
            setSessionVolumeState(v);
          }}
        />
      </GroupedList>
      <EditorPreferences />
      <GroupedList label={body}>
        <MenuRow
          icon={Check}
          label={t("settings.rangePill")}
          value={rangePill}
          options={SHOWN.map((v) => ({
            value: v,
            label: t(`settings.rangePillOptions.${v}`),
          }))}
          onChange={(v) => {
            setRangePill(v);
            setRangePillState(v);
          }}
        />
        <MenuRow
          icon={Utensils}
          label={t("settings.weekIntake")}
          value={weekIntake}
          options={SHOWN.map((v) => ({
            value: v,
            label: t(`settings.weekIntakeOptions.${v}`),
          }))}
          onChange={(v) => {
            setWeekIntake(v);
            setWeekIntakeState(v);
          }}
        />
      </GroupedList>
      <GroupedList label={tools}>
        <MenuRow
          icon={Weight}
          label={t("settings.oneRepMax")}
          value={brzycki}
          options={SHOWN.map((v) => ({
            value: v,
            label: t(`settings.oneRepMaxOptions.${v}`),
          }))}
          onChange={(v) => {
            setBrzycki(v);
            setBrzyckiState(v);
          }}
        />
        <MenuRow
          icon={Info}
          label={t("settings.fieldSources")}
          value={fieldSources}
          options={SHOWN.map((v) => ({
            value: v,
            label: t(`settings.fieldSourcesOptions.${v}`),
          }))}
          onChange={(v) => {
            setFieldSources(v);
            setFieldSourcesState(v);
          }}
        />
      </GroupedList>

      {account.kind === "open" && <TrackingGroup account={account} />}
      {account.kind === "unavailable" && <TrackingGroup account={null} />}

      {/* The page's end: sign-out and the version sit at the bottom of a page that fits, and
          follow the last group, 24 px under it at least, on a page that scrolls. */}
      <div className="mt-auto flex flex-col gap-4">
        {account.kind === "open" && <OpenAccountSettings account={account} />}
        {/* The local database never opened, so what is still waiting is unknown. */}
        {account.kind === "unavailable" && <SignOutGroup pending={null} />}
        <VersionLine />
      </div>
    </section>
  );
}

// The program editor's tastes, kept on this device and read by the editor when it draws. The
// editor opens on a computer only, so its group shows from the large breakpoint.
function EditorPreferences() {
  const { t } = useTranslation();
  const [rest, setRestState] = useState(readRestStyle);
  const [thumbs, setThumbsState] = useState(readThumbs);
  const [help, setHelpState] = useState(readHelp);
  const [added, setAddedState] = useState(readAdded);
  return (
    <div className="hidden lg:block">
      <GroupedList label={t("settings.editor")}>
        <MenuRow
          icon={Timer}
          label={t("settings.editorRest")}
          value={rest}
          options={(["words", "clock"] as const).map((v) => ({
            value: v,
            label: t(`settings.editorRestOptions.${v}`),
          }))}
          onChange={(v) => {
            setRestStyle(v);
            setRestState(v);
          }}
        />
        <MenuRow
          icon={ImageIcon}
          label={t("settings.editorThumbs")}
          value={thumbs}
          options={(["shown", "hidden"] as const).map((v) => ({
            value: v,
            label: t(`settings.editorThumbsOptions.${v}`),
          }))}
          onChange={(v) => {
            setThumbs(v);
            setThumbsState(v);
          }}
        />
        <MenuRow
          icon={Keyboard}
          label={t("settings.editorHelp")}
          value={help}
          options={(["always", "focus"] as const).map((v) => ({
            value: v,
            label: t(`settings.editorHelpOptions.${v}`),
          }))}
          onChange={(v) => {
            setHelp(v);
            setHelpState(v);
          }}
        />
        <MenuRow
          icon={ListPlus}
          label={t("settings.editorAdded")}
          value={added}
          options={(["defaults", "above"] as const).map((v) => ({
            value: v,
            label: t(`settings.editorAddedOptions.${v}`),
          }))}
          onChange={(v) => {
            setAdded(v);
            setAddedState(v);
          }}
        />
      </GroupedList>
    </div>
  );
}

// The person at the top of the page: a tap opens Profil, which the second line sums up.
function ProfileRow({ user }: { user: LastUser }) {
  const { t } = useTranslation();
  const initial = initialOf(user.displayName);
  return (
    <GroupedList>
      <RowLink
        to="/settings/profile"
        prominent
        leading={
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-round bg-track text-title-compact text-foreground"
          >
            {initial ?? <UserRound className="size-6" />}
          </span>
        }
        label={user.displayName.trim() || t("profile.title")}
        sub={t("settings.profileSub")}
        trailing="push"
      />
    </GroupedList>
  );
}

// Compléments, with how many are on the list once the device has read it.
function TrackingGroup({ account }: { account: OpenAccount | null }) {
  const { t } = useTranslation();
  return (
    <GroupedList label={t("settings.tracking")}>
      {account ? <CountedSupplementsRow account={account} /> : <SupplementsRow />}
    </GroupedList>
  );
}

function CountedSupplementsRow({ account }: { account: OpenAccount }) {
  const list = useSupplements(account).data;
  return <SupplementsRow count={list?.filter((s) => !s.removed).length} />;
}

function SupplementsRow({ count }: { count?: number }) {
  const { t } = useTranslation();
  return (
    <RowLink
      to="/settings/supplements"
      icon={Pill}
      label={t("settings.supplements")}
      value={count === undefined ? undefined : t("settings.supplementsCount", { count })}
      trailing="push"
    />
  );
}

function VersionLine() {
  const { t } = useTranslation();
  const url = releaseUrl(APP_VERSION);
  return (
    <p className="text-center text-xs text-muted-foreground">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center px-3 underline underline-offset-2"
        >
          {/* The space sits outside the hidden hint: some name computations trim its edges. */}
          {t("settings.versionNotes", { version: APP_VERSION })}{" "}
          <span className="sr-only">{t("settings.newTab")}</span>
        </a>
      ) : (
        t("settings.version", { version: APP_VERSION })
      )}
    </p>
  );
}

// Shown once the device has said what is waiting, so signing out never skips the warning.
function OpenAccountSettings({ account }: { account: OpenAccount }) {
  const { data, isError } = usePending(account);
  // The read failed: the count is unknown, so sign-out stays available and always asks first.
  const settings = isError ? (
    <SignOutGroup pending={null} />
  ) : data ? (
    <SignOutGroup pending={data.total} />
  ) : null;
  return settings;
}

// What a refused entry was, as the person entered it. A removal or a tick carries no name or day
// of its own: the device still holds the row it points to.
type Known = { names: Map<string, string>; days: Map<string, string> };
function describe(
  change: Change,
  t: TFunction,
  locale: string,
  today: string,
  known: Known,
): string {
  const day = (date: string) => formatWeekday(date, locale, today, { startOfLine: false });
  const name = (id: string) => known.names.get(id) ?? t("settings.rejected.supplementUnnamed");
  switch (change.kind) {
    case "weight":
      return t("settings.rejected.weight", { day: day(change.date) });
    case "target":
      return t("settings.rejected.target");
    case "measure":
      return t(`settings.rejected.measure.${change.field}`, { day: day(change.date) });
    case "intake":
      return t("settings.rejected.intake", { day: day(change.date) });
    case "profile":
      return t("settings.rejected.profile", {
        field: t(`settings.rejected.profileFields.${change.field}`),
      });
    case "supplement":
      return t("settings.rejected.supplement", {
        name: change.field === "name" ? change.value : name(change.id),
      });
    case "supplementLog":
      return t("settings.rejected.supplementLog", {
        name: name(change.supplementId),
        day: day(change.date),
      });
    case "annotation": {
      const date = change.field === "fields" ? change.date : known.days.get(change.id);
      return date
        ? t("settings.rejected.annotation", { day: day(date) })
        : t("settings.rejected.annotationUndated");
    }
    case "steps":
      return t("settings.rejected.steps", { day: day(change.date) });
    case "activity":
      return change.field === "fields"
        ? t("settings.rejected.activity", { day: day(change.date) })
        : t("settings.rejected.activityUndated");
    case "workout":
      return change.field === "start"
        ? t("settings.rejected.workout", {
            day: day(toISODate(new Date(change.startedAt))),
          })
        : t("settings.rejected.workoutUndated");
    case "set":
      return change.field === "create"
        ? t("settings.rejected.set", { day: day(toISODate(new Date(change.doneAt))) })
        : t("settings.rejected.setUndated");
    case "program":
    case "activeProgram":
    case "programSession":
    case "programSlot":
      return t("workouts.tabs.program");
  }
}

// The entries the server refused (§7.1): out of the queue, listed here until the person clears
// them, so a refusal is never silent.
function RejectedEntries({ account }: { account: OpenAccount }) {
  const { t, i18n } = useTranslation();
  const today = useToday();
  const rejected = useRejected(account).data ?? [];
  const known: Known = {
    names: new Map((useSupplements(account).data ?? []).map((r) => [r.id, r.name])),
    days: new Map((useAnnotations(account).data ?? []).map((r) => [r.id, r.date])),
  };
  const clear = useClearRejected(account);
  if (rejected.length === 0) return null;
  return (
    <GroupedList label={t("settings.rejected.title")} footer={t("settings.rejected.note")}>
      {rejected.map((r) => (
        <RowText
          key={r.id}
          label={describe(r.change, t, i18n.language, today, known)}
          detail={t(`settings.rejected.reasons.${r.reason}`)}
        />
      ))}
      <RowButton label={t("settings.rejected.clear")} onClick={() => void clear()} />
    </GroupedList>
  );
}

// Signing out keeps the entries on the device (D3), and always asks first, saying what is still
// waiting. The sheet closes as soon as its action is chosen; the row stays disabled while the
// request runs, so a second tap cannot send it twice, and takes the focus back if it fails.
function SignOutGroup({ pending }: { pending: number | null }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  // "always": offline, the request fails at once and we can say so, instead of pausing forever.
  const signOut = useMutation({ mutationFn: logout, networkMode: "always" });
  const busy = signOut.isPending || signOut.isSuccess;
  const rowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (signOut.isError) rowRef.current?.focus();
  }, [signOut.isError]);
  // The extra room above sets the destructive group apart, and lets the open Thème menu end in
  // the row's top padding instead of across its label.
  return (
    <div className="mt-6 flex flex-col gap-2">
      <GroupedList>
        <RowButton
          ref={rowRef}
          destructive
          label={t("settings.signOut")}
          disabled={busy}
          onClick={() => setConfirming(true)}
        />
      </GroupedList>
      {signOut.isError && (
        <p role="alert" className="px-4 text-body">
          {t("settings.signOutFailed")}
        </p>
      )}
      {confirming && (
        <ActionSheet
          title={t("settings.signOutTitle")}
          body={
            pending === null
              ? t("settings.signOutUnknown")
              : pending > 0
                ? t("settings.signOutPending", { count: pending })
                : t("settings.signOutNothing")
          }
          confirm={pending === 0 ? t("settings.signOut") : t("settings.signOutAnyway")}
          busy={busy}
          onConfirm={() => signOut.mutate()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
