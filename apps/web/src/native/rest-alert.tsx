// The iPhone app keeps the locked phone and Apple Health in step with the open account: a
// notification at the rest's end says when to get back to it, the lock screen shows the session
// itself, and Health holds the finished sessions and weigh-ins. Mounted once by the shell on the
// phone. Health's part comes with this module, itself loaded on the phone only: a lazy import of
// it from here made the build move React into a startup file of its own.
import "@/i18n/lazy";
import type { PauseStops } from "@belay/shared/training/pause";
import type { PermissionStatus } from "@capacitor/local-notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { readPauseStops } from "@/lib/pause-stops";
import { nativePlatform } from "@/lib/platform";
import { readRestSound } from "@/lib/rest-sound";
import { type Account, type OpenAccount, useHistory, useSessionView } from "@/sync/account";
import type { ActiveSession } from "@/sync/db";
import { HealthMirror } from "./health-mirror";
import {
  liveActivityOf,
  type OpenSession,
  resendLiveActivity,
  showLiveActivity,
} from "./live-activity";

// One notification at a time: scheduling under the same id replaces the pending one.
const ID = 1;
type Display = PermissionStatus["display"];

// Android shows a notification over the app, with its sound, where iOS keeps it quiet: there it
// stays pending only while the app is hidden, since the rest bar, the tone and the haptic already
// tell the end on screen.
function useHidden(android: boolean): boolean {
  const [hidden, setHidden] = useState(() => android && document.visibilityState === "hidden");
  useEffect(() => {
    if (!android) return;
    const update = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [android]);
  return hidden;
}

type Notifications = typeof import("@capacitor/local-notifications").LocalNotifications;
// Loaded with the first call rather than with this module, so the startup bundle's list of what
// this module needs stays one file shorter. Wrapped: Capacitor's plugin proxy answers « then » too,
// so a promise resolved with the plugin itself would call it and never settle.
const plugin = (): Promise<{ notes: Notifications }> =>
  import("@capacitor/local-notifications").then((m) => ({ notes: m.LocalNotifications }));

// Calls run one after the other, so a cancel never lands after the schedule that follows it.
let queue: Promise<unknown> = Promise.resolve();
function run(step: (notes: Notifications) => Promise<unknown>): void {
  queue = queue
    .then(plugin)
    .then(({ notes }) => step(notes))
    .catch(() => {
      // A refused permission or a missing plugin leaves notifications off and changes nothing
      // else: the rest bar, the tone and the haptic still tell the end of a rest in the app.
    });
}
// Android's cancel only reaches a pending alert: one already in the shade is removed as well, so
// it goes once the app is shown again, the rest is over or the person has left.
const cancel = async (notes: Notifications) => {
  await notes.cancel({ notifications: [{ id: ID }] });
  if (nativePlatform() === "android") await notes.removeDeliveredNotificationsById({ ids: [ID] });
};

// When the pending notification should ring: the rest's end while it runs, nothing once it has
// passed. A pause that stops everything holds the rest still, so nothing rings until the resume
// writes the later end.
export function restAlertAt(
  active: ActiveSession | null | undefined,
  stops: PauseStops,
  now: number,
): string | null {
  const end = active?.restEndsAt;
  if (!end) return null;
  if (active.pausedAt && stops === "all") return null;
  return Date.parse(end) <= now ? null : end;
}

export function NativeRestAlert({
  account,
  session,
}: {
  account: Account;
  session: OpenSession | null;
}) {
  // Signing out reloads the page, so nothing unmounts there: the first page without an open
  // account clears what the last session left pending.
  const open = account.kind === "open";
  useEffect(() => {
    if (!open) run(cancel);
  }, [open]);
  // The same for the lock screen, but not while the account is still loading: an Activity left
  // by the last run may still be the open session's, and ending it would keep it away for good.
  useEffect(() => {
    if (account.kind === "signed-out" || account.kind === "unavailable") showLiveActivity(null);
  }, [account.kind]);
  return account.kind === "open" ? (
    <>
      <RestAlert account={account} session={session} />
      <HealthMirror account={account} />
    </>
  ) : null;
}

function RestAlert({
  account,
  session,
}: {
  account: OpenAccount;
  session: OpenSession | null;
}): null {
  const { t } = useTranslation();
  const view = useSessionView(account).data;
  const history = useHistory(account).data;
  const active = view?.active;
  // Until this phone's records are read, no session looks open: nothing is described yet.
  const read = view !== undefined && history !== undefined;
  const at = restAlertAt(active, readPauseStops(), Date.now());
  const workoutId = active?.workoutId;
  const android = nativePlatform() === "android";
  const hidden = useHidden(android);

  // Asked once per launch, when a session first opens: the question then makes sense.
  const [display, setDisplay] = useState<Display | null>(null);
  const known = useRef<Display | null>(null);
  const learn = useCallback(
    (before: Display | null, after: Display) => {
      // Android posted nothing for the session while notifications were off: once they are
      // allowed, its description goes again.
      if (android && before !== "granted" && after === "granted") resendLiveActivity();
      known.current = after;
      setDisplay(after);
    },
    [android],
  );
  const asked = useRef(false);
  useEffect(() => {
    if (workoutId === undefined || asked.current) return;
    asked.current = true;
    run(async (notes) => {
      const { display: before } = await notes.checkPermissions();
      learn(before, before === "prompt" ? (await notes.requestPermissions()).display : before);
    });
  }, [workoutId, learn]);
  // Read again each time the app comes back, once asked: notifications may have been allowed or
  // turned off in the phone's settings meanwhile. Only Android reports the app hidden.
  const away = useRef(false);
  useEffect(() => {
    if (hidden) away.current = true;
    if (hidden || !away.current || !asked.current) return;
    away.current = false;
    run(async (notes) => learn(known.current, (await notes.checkPermissions()).display));
  }, [hidden, learn]);

  useEffect(() => {
    run(async (notes) => {
      await cancel(notes);
      if (at === null || display !== "granted" || (android && !hidden)) return;
      const sound = readRestSound() !== "off";
      await notes.schedule({
        notifications: [
          {
            id: ID,
            title: t("session.restOver"),
            body: t("session.backToIt"),
            // Android rings it exactly, even with the phone idle; iOS ignores the flag.
            schedule: android ? { at: new Date(at), allowWhileIdle: true } : { at: new Date(at) },
            // No banner while the app is in the foreground: the rest bar, the tone and the haptic
            // already tell it there. The sound follows the Silent switch, as every notification
            // does without Apple's critical alert entitlement.
            silent: true,
            ...(sound ? { sound: "rest.wav" } : {}),
            // On Android the sound belongs to the channel, and the small icon is Belay's mark, as
            // on the session notification, instead of the plugin's generic one.
            ...(android
              ? { channelId: sound ? "rest" : "rest-quiet", smallIcon: "ic_stat_belay" }
              : {}),
          },
        ],
      });
    });
    // Only a new end, the answer to the question, or the app hidden or shown on Android changes
    // what is pending.
  }, [at, display, t, android, hidden]);
  // Leaving the account unmounts this: nothing rings for a person who left.
  useEffect(() => () => run(cancel), []);

  // Described on every render: the queue drops a description it already sent, so iOS hears of a
  // change once. The pause setting is read here too, so a change shows at the next render.
  useEffect(() => {
    if (read) showLiveActivity(liveActivityOf(session, active, readPauseStops(), Date.now(), t));
  });
  // Nothing stays on the lock screen for a person who left.
  useEffect(() => () => showLiveActivity(null), []);
  return null;
}
