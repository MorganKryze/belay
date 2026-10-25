// The rest's end as a notification in the iPhone app, so a locked phone still says when to get
// back to it. Mounted once by the shell on the phone.
import "@/i18n/lazy";
import type { PauseStops } from "@belay/shared/training/pause";
import type { PermissionStatus } from "@capacitor/local-notifications";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { readPauseStops } from "@/lib/pause-stops";
import { readRestSound } from "@/lib/rest-sound";
import { type Account, type OpenAccount, useSessionView } from "@/sync/account";
import type { ActiveSession } from "@/sync/db";

// One notification at a time: scheduling under the same id replaces the pending one.
const ID = 1;

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
const cancel = (notes: Notifications) => notes.cancel({ notifications: [{ id: ID }] });

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

export function NativeRestAlert({ account }: { account: Account }) {
  // Signing out reloads the page, so nothing unmounts there: the first page without an open
  // account clears what the last session left pending.
  const open = account.kind === "open";
  useEffect(() => {
    if (!open) run(cancel);
  }, [open]);
  return account.kind === "open" ? <RestAlert account={account} /> : null;
}

function RestAlert({ account }: { account: OpenAccount }): null {
  const { t } = useTranslation();
  const active = useSessionView(account).data?.active;
  const at = restAlertAt(active, readPauseStops(), Date.now());
  const workoutId = active?.workoutId;

  // Asked once per launch, when a session first opens: the question then makes sense.
  const [display, setDisplay] = useState<PermissionStatus["display"] | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (workoutId === undefined || asked.current) return;
    asked.current = true;
    run(async (notes) => {
      const status = await notes.checkPermissions();
      setDisplay(
        status.display === "prompt" ? (await notes.requestPermissions()).display : status.display,
      );
    });
  }, [workoutId]);

  useEffect(() => {
    run(async (notes) => {
      await cancel(notes);
      if (at === null || display !== "granted") return;
      await notes.schedule({
        notifications: [
          {
            id: ID,
            title: t("session.restOver"),
            body: t("session.backToIt"),
            schedule: { at: new Date(at) },
            // No banner while the app is in the foreground: the rest bar, the tone and the haptic
            // already tell it there. The sound follows the Silent switch, as every notification
            // does without Apple's critical alert entitlement.
            silent: true,
            ...(readRestSound() === "off" ? {} : { sound: "rest.wav" }),
          },
        ],
      });
    });
    // Only a new end, or the answer to the question, changes what is pending.
  }, [at, display, t]);
  // Leaving the account unmounts this: nothing rings for a person who left.
  useEffect(() => () => run(cancel), []);
  return null;
}
