import "@/i18n/lazy";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  HeartPulse,
  History,
  type LucideIcon,
  Send,
} from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ActionSheet } from "@/components/action-sheet";
import { BackLink, PageHeader } from "@/components/page-header";
import { GroupedList, RowButton, RowLink, RowSwitch } from "@/components/grouped-list";
import { formatDay } from "@/lib/format";
import {
  askImportHistory,
  health,
  type HealthState,
  type HealthStatus,
  healthProgress,
  importHistory,
  readHealth,
  requestHealthRun,
  setHealthOn,
  setHistory,
  setImportOn,
} from "@/native/health";
import { historyCounts } from "@/native/health-plan";
import { nativePlatform, readInstance } from "@/lib/platform";
import { type OpenAccount, useAccount } from "@/sync/account";
import { NotFound } from "./fallbacks";

// On Android the page names Health Connect and the phone where the iPhone's names Apple Health and
// the iPhone. The keys that differ have an `_android` variant; any other key falls back to the
// iPhone's words.
const words = () => ({ context: nativePlatform() === "android" ? "android" : undefined });

const footnote =
  "px-4 text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground";

// A build without the Health entitlement answers every call with an error: for this app, Health
// is not there, so nothing about it shows.
const NO_HEALTH: HealthStatus = {
  available: false,
  workouts: "undetermined",
  weighings: "undetermined",
};

// What iOS says of Health on this phone, asked when a screen showing it mounts and again when the
// app comes back to the foreground, since an access changed in iOS Settings shows only then.
// Undefined until it answers.
export function useHealthStatus(): HealthStatus | undefined {
  const { data, refetch } = useQuery({
    queryKey: ["native", "health-status"],
    queryFn: () => health({ op: "status" }).catch(() => NO_HEALTH),
    networkMode: "always",
  });
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [refetch]);
  return data;
}

const bothRefused = (s: HealthStatus) => s.workouts === "denied" && s.weighings === "denied";

// The account's Health state on this phone, and the run's progress. The shell's runner tells the
// state's readers after each run; the page tells them after each of its own writes.
function useHealthState(account: OpenAccount) {
  const queryClient = useQueryClient();
  const key = ["local", account.user.id, "health"];
  const state = useQuery({
    queryKey: key,
    queryFn: () => readHealth(account.db),
    networkMode: "always",
  }).data;
  const progress = useSyncExternalStore(healthProgress.subscribe, healthProgress.get);
  const changed = () => queryClient.invalidateQueries({ queryKey: key });
  return { state, progress, changed };
}

// Réglages' « Sur cet iPhone » group (« Sur ce téléphone » on Android): the row to the page,
// saying whether the setting is on, or that the system refuses both writes (icon and word, never
// red). Nothing until it says Health is there.
export function HealthGroup({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  const status = useHealthStatus();
  const { state } = useHealthState(account);
  if (!status?.available || !state) return null;
  const value = bothRefused(status) ? (
    <span className="inline-flex items-center gap-1">
      <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-primary-ink" />
      {t("health.refused")}
    </span>
  ) : (
    t(state.settings.on ? "health.on" : "health.off")
  );
  return (
    <GroupedList label={t("settings.onThisPhone", words())}>
      <RowLink
        to="/settings/health"
        icon={HeartPulse}
        label={t("health.title", words())}
        value={value}
        trailing="push"
      />
    </GroupedList>
  );
}

// Réglages › Apple Santé (Santé Connect on Android), in the phone app only (the route is not
// found in a browser), and only where Health exists. Nothing shows while the system has not
// answered.
export function HealthPage() {
  const { t } = useTranslation();
  const account = useAccount();
  const status = useHealthStatus();
  if (account.kind === "loading" || (account.kind === "open" && status === undefined)) return null;
  if (account.kind !== "open" || !status?.available) return <NotFound />;
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={t("health.title", words())}
        focusFallback
        back={
          <BackLink to="/settings" activeOptions={{ exact: true }}>
            {t("settings.title")}
          </BackLink>
        }
      />
      <p className="px-1 text-body text-muted-foreground">{t("health.intro", words())}</p>
      <HealthSettings account={account} status={status} />
      <div className="mt-1 flex flex-col gap-2">
        <p className={footnote}>{t("health.footerSets", words())}</p>
        <p className={footnote}>{t("health.footerWatch")}</p>
        <p className={footnote}>{t("health.footerOff", words())}</p>
      </div>
    </section>
  );
}

function HealthSettings({ account, status }: { account: OpenAccount; status: HealthStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { state, progress, changed } = useHealthState(account);
  if (!state) return null;
  const { settings, imported } = state;
  const refused = bothRefused(status);

  // iOS asks once per type; later it answers at once. The answer is the new status. A rejected
  // call (a build without the entitlement) leaves the setting off with nothing more to say.
  const turnOn = async () => {
    let answer: HealthStatus;
    try {
      answer = await health({ op: "authorize", scope: "write" });
    } catch {
      return;
    }
    queryClient.setQueryData(["native", "health-status"], answer);
    if (answer.workouts !== "allowed" && answer.weighings !== "allowed") return;
    await setHealthOn(account.db, true, Date.now());
    await changed();
    requestHealthRun();
  };
  const turnOff = async () => {
    await setHealthOn(account.db, false, Date.now());
    await changed();
  };

  return (
    <>
      <GroupedList footer={refused ? t("health.refusedHelp", words()) : undefined}>
        <RowSwitch
          label={t("health.switch")}
          sub={t("health.switchSub", words())}
          wrap
          checked={settings.on}
          onCheckedChange={(on) => void (on ? turnOn() : turnOff())}
        />
        {refused && (
          <InfoRow
            icon={CircleAlert}
            label={t("health.refused")}
            detail={t("health.refusedDetail", words())}
          />
        )}
      </GroupedList>
      {settings.on && !refused && (
        <GroupedList label={t("health.toHealth", words())}>
          <SendingStatus status={status} progress={progress} />
          {settings.history === "no" && !progress.sending && (
            <HistoryOffer account={account} onAsk={changed} />
          )}
          {settings.history === "sent" && !progress.sending && (
            <InfoRow icon={Check} tone="reference" label={t("health.sent")} />
          )}
        </GroupedList>
      )}
      {settings.on && (
        <ImportGroup
          account={account}
          status={status}
          settings={settings}
          imported={imported}
          onChange={changed}
        />
      )}
    </>
  );
}

type ImportProps = Pick<HealthState, "settings" | "imported"> & {
  account: OpenAccount;
  status: HealthStatus;
  onChange: () => Promise<void>;
};

// Weigh-ins from Health, asked only after a consent that names the server they will be synced
// with. « Importer » alone turns it on; Annuler, a swipe or a tap outside leaves it off, and the
// sheet gives the focus back to the switch.
function ImportGroup({ account, status, settings, imported, onChange }: ImportProps) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const on = settings.importOn;
  // The iPhone app always has its instance once an account is open.
  const host = new URL(readInstance()!).host;
  // iOS never says whether a read is allowed, so the answer changes nothing here; a rejected call
  // (a build without the entitlement) leaves the import off.
  const turnOn = async () => {
    try {
      await health({ op: "authorize", scope: "import" });
    } catch {
      return;
    }
    await setImportOn(account.db, true, Date.now());
    await onChange();
    // The first import follows the sync this starts, or the one already going.
    void account.engine.refresh();
  };
  const turnOff = async () => {
    await setImportOn(account.db, false, Date.now());
    await onChange();
  };
  return (
    <>
      <GroupedList
        label={t("health.fromHealth", words())}
        footer={on ? t("health.importNote", words()) : undefined}
      >
        <RowSwitch
          label={t("health.import")}
          sub={t("health.importSub", words())}
          wrap
          checked={on}
          onCheckedChange={(next) => (next ? setAsking(true) : void turnOff())}
        />
        {on && (
          <HistoryImport
            account={account}
            status={status}
            settings={settings}
            imported={imported}
            onChange={onChange}
          />
        )}
      </GroupedList>
      {asking && (
        <ActionSheet
          title={t("health.consentTitle", words())}
          body={
            <Trans
              i18nKey="health.consentBody"
              context={words().context}
              values={{ host }}
              components={{ host: <strong className="font-semibold break-all text-foreground" /> }}
            />
          }
          primary={{ label: t("health.consentConfirm"), onSelect: () => void turnOn() }}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  );
}

// The weigh-ins Health holds from before the import's day, read on the person's gesture. The live
// region stays in place from the offer on, so a screen reader says the start and the end. Apple
// Health has no window and answers no `history`, which leaves the iPhone out of everything below
// that reads it.
function HistoryImport({ account, status, settings, imported, onChange }: ImportProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const state = importHistory(settings, imported);
  const { history } = status;
  const closed = history === "undetermined" || history === "denied";
  // Health Connect's screen, while its permission can still be given. The read goes on whatever it
  // answers; a rejected call (a screen already open) starts nothing.
  const read = async () => {
    let answer = status;
    if (closed) {
      try {
        answer = await health({ op: "authorize", scope: "history" });
      } catch {
        return;
      }
      queryClient.setQueryData(["native", "health-status"], answer);
    }
    const windowed = answer.history !== undefined && answer.history !== "allowed";
    await askImportHistory(account.db, windowed);
    await onChange();
    // The read follows the sync this starts, or the one already going.
    void account.engine.refresh();
  };
  const windowNote = closed
    ? t("health.historyWindow")
    : history === "unavailable"
      ? `${t("health.historyWindow")} ${t("health.historyNotOffered")}`
      : undefined;
  return (
    <>
      <div role="status">
        {state === "importing" && (
          <div className="flex min-h-14 items-center gap-3 px-4 py-2">
            <BusyTile />
            <span className="min-w-0 flex-1 text-body font-semibold">
              {t("health.importingHistory")}
            </span>
          </div>
        )}
        {state === "done" && (
          <InfoRow
            icon={Check}
            tone="reference"
            label={t("health.historyImported")}
            detail={windowNote}
          />
        )}
      </div>
      {state === "offered" && (
        <RowButton
          icon={History}
          label={t("health.importHistory", words())}
          sub={t("health.importHistorySub", {
            // The import's own day: "offered" means it holds one.
            date: formatDay(new Date(settings.importSince!), i18n.language, new Date()),
          })}
          wrap
          className="text-primary"
          onClick={() => void read()}
        />
      )}
      {state === "done" && (closed || (history === "allowed" && imported.historyWindowed)) && (
        <RowButton
          icon={History}
          label={t("health.importOlder")}
          sub={
            closed
              ? t(history === "denied" ? "health.importOlderDenied" : "health.importOlderAsk")
              : undefined
          }
          wrap
          className="border-t border-border text-primary"
          onClick={() => void read()}
        />
      )}
    </>
  );
}

// The state of what goes to Health, a polite live region. While the history goes, its progress
// takes the row's place (« À jour » would be false), and the region says only the start and the
// end: it holds the first count, then empties, which a screen reader does not read.
function SendingStatus({
  status,
  progress,
}: {
  status: HealthStatus;
  progress: ReturnType<typeof healthProgress.get>;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const { sending, pending } = progress;
  const [first, setFirst] = useState(sending);
  if (sending && !first) setFirst(sending);
  if (!sending && first) setFirst(null);
  const announced =
    sending && first && sending.done === first.done ? t("health.sending", first) : "";
  return (
    <div>
      <div role="status" className={sending ? "sr-only" : undefined}>
        {sending ? (
          announced
        ) : status.weighings !== "allowed" ? (
          <InfoRow
            icon={CircleAlert}
            label={t("health.refusesWeighings", words())}
            detail={t("health.onlySessions")}
          />
        ) : status.workouts !== "allowed" ? (
          <InfoRow
            icon={CircleAlert}
            label={t("health.refusesWorkouts", words())}
            detail={t("health.onlyWeighings")}
          />
        ) : pending > 0 ? (
          <InfoRow
            icon={Clock}
            label={t("health.pending", { count: pending })}
            detail={t("health.pendingDetail", words())}
          />
        ) : (
          <InfoRow icon={CircleCheck} tone="reference" label={t("health.upToDate", words())} />
        )}
      </div>
      {sending && (
        <div className="flex min-h-14 items-center gap-3 px-4 py-2">
          <BusyTile />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span id={labelId} className="text-body font-semibold tabular-nums">
              {t("health.sending", sending)}
            </span>
            {/* The track is outlined in the input token, which keeps 3:1 on the card. */}
            <span
              role="progressbar"
              aria-labelledby={labelId}
              aria-valuemin={0}
              aria-valuemax={sending.total}
              aria-valuenow={sending.done}
              className="block h-2 overflow-hidden rounded-round border border-input bg-track"
            >
              <span
                className="block h-full rounded-round bg-primary"
                style={{ width: `${(sending.done / Math.max(sending.total, 1)) * 100}%` }}
              />
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

// « Envoyer l’historique » with what would go, so the person knows before tapping: Belay cannot
// take back what it sends.
function HistoryOffer({ account, onAsk }: { account: OpenAccount; onAsk: () => Promise<void> }) {
  const { t } = useTranslation();
  const counts = useQuery({
    queryKey: ["local", account.user.id, "health", "counts"],
    queryFn: async () => {
      // The stores as the run reads them, in one transaction.
      const tx = account.db.transaction(["workouts", "sets", "weights"]);
      const [workouts, sets, weights, state] = await Promise.all([
        tx.objectStore("workouts").getAll(),
        tx.objectStore("sets").getAll(),
        tx.objectStore("weights").getAll(),
        readHealth(account.db),
      ]);
      return historyCounts({
        workouts,
        sets,
        weights,
        settings: state.settings,
        written: state.written,
        filled: state.imported.filled,
      });
    },
    networkMode: "always",
  }).data;
  if (!counts) return null;
  return (
    <RowButton
      icon={Send}
      label={t("health.history", words())}
      sub={t("health.historySub", {
        sessions: t("health.sessions", { count: counts.sessions }),
        weighings: t("health.weighings", { count: counts.weighings }),
      })}
      wrap
      className="text-primary"
      onClick={async () => {
        await setHistory(account.db, "asked");
        await onAsk();
        requestHealthRun();
      }}
    />
  );
}

const tile = (tone: "primary" | "reference") =>
  `flex size-7 shrink-0 items-center justify-center rounded-icon ${
    tone === "reference" ? "bg-reference text-reference-ink" : "bg-primary-soft text-primary-ink"
  }`;

function BusyTile() {
  return (
    <span className={tile("primary")}>
      <span
        aria-hidden="true"
        className="size-4.5 animate-spin-arc rounded-round border-2 border-current border-t-transparent"
      />
    </span>
  );
}

// A row that only reads, with its icon square: the label bold, the detail muted, both wrapping.
// The alert is drawn in the accent's ink, never red: it says why, it does not warn.
function InfoRow({
  icon: Icon,
  label,
  detail,
  tone = "primary",
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  tone?: "primary" | "reference";
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2">
      <span className={tile(tone)}>
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body font-semibold break-words">{label}</span>
        {detail && (
          <>
            {" "}
            <span className="text-(length:--text-secondary) leading-(--text-secondary--line-height) break-words text-muted-foreground">
              {detail}
            </span>
          </>
        )}
      </span>
    </div>
  );
}
