import { useIsFetching, useQuery } from "@tanstack/react-query";
import { useEffect, useReducer, useState } from "react";
import { type OpenAccount, useSyncStatus } from "@/sync/account";
import { readCursor } from "@/sync/db";
import type { SyncEngine, SyncStatus } from "@/sync/engine";

// From app start, as the launch screen's safety hold: an answer that never comes must not keep
// Today's rows blank.
export const FIRST_PULL_CAP_MS = 4000;

// Whether Today should wait for the first pull before saying nothing was entered. A cursor still
// at "0" means this device never received the account's data; a brand-new account keeps that
// cursor after its first sync, so the wait ends with the end of the first run, never on the
// cursor alone.
export function firstPullPending(s: {
  cursor: string | undefined; // undefined: not read yet
  status: SyncStatus;
  sawSyncing: boolean; // this engine was seen "syncing" during this visit
  elapsed: number; // performance.now()
}): boolean {
  if (s.cursor === undefined) return true;
  if (s.cursor !== "0" || s.elapsed >= FIRST_PULL_CAP_MS) return false;
  if (s.status === "offline" || s.status === "expired" || s.status === "failed") return false;
  return s.status === "syncing" || !s.sawSyncing;
}

// Engines seen syncing during this visit: a run that starts and ends between two renders still
// counts, through the subscription below.
const sawSyncing = new WeakSet<SyncEngine>();

export function useFirstPull(account: OpenAccount): boolean {
  const { engine } = account;
  const cursor = useQuery({
    queryKey: ["local", account.user.id, "cursor"],
    queryFn: () => readCursor(account.db),
    networkMode: "always",
  }).data;
  const status = useSyncStatus(account);
  if (status === "syncing") sawSyncing.add(engine);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () =>
      engine.subscribe(() => {
        if (engine.status() === "syncing") sawSyncing.add(engine);
        rerender();
      }),
    [engine],
  );
  const pending = firstPullPending({
    cursor,
    status,
    sawSyncing: sawSyncing.has(engine),
    elapsed: performance.now(),
  });
  // One timer re-renders at the cap when it is still ahead.
  useEffect(() => {
    if (!pending) return;
    const left = FIRST_PULL_CAP_MS - performance.now();
    if (left <= 0) return;
    const timer = setTimeout(rerender, left);
    return () => clearTimeout(timer);
  }, [pending]);
  // The run that ends the wait refreshes every local read at once, and the cursor may land before
  // the weigh-ins: the wait holds until those reads are in, or a row would flash empty.
  const reading = useIsFetching({ queryKey: ["local", account.user.id] }) > 0;
  const [held, setHeld] = useState(true);
  if (pending && !held) setHeld(true);
  if (!pending && held && !reading) setHeld(false);
  return pending || held;
}
