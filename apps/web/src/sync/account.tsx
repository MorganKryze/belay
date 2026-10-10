import type { Change } from "@belay/shared/sync/schema";
import type { Slot } from "@belay/shared/training/workout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { fetchMe } from "@/lib/api";
import {
  type AccountDb,
  type ActiveSession,
  clearRejected,
  closeForgotten,
  openAccountDb,
  pendingCounts,
  readAnnotations,
  readHistory,
  readIntake,
  readMeasures,
  readProfile,
  readRejected,
  readSessionView,
  readSupplementLogs,
  readSupplements,
  readTarget,
  readWeights,
  recordChanges,
  recordSet,
  type SetInput,
  startWorkout,
} from "./db";
import { createSyncEngine, type SyncEngine } from "./engine";
import { type LastUser, readLastUser, writeLastUser } from "./last-user";

export type OpenAccount = { kind: "open"; user: LastUser; db: AccountDb; engine: SyncEngine };
export type Account =
  | { kind: "loading" }
  | { kind: "signed-out"; unreachable: boolean }
  | OpenAccount
  | { kind: "unavailable"; user: LastUser }; // this browser refused to open the local database

const AccountContext = createContext<Account>({ kind: "loading" });
export const useAccount = () => useContext(AccountContext);

type Opened = { userId: string; db: AccountDb; engine: SyncEngine } | { userId: string };

export function AccountProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // "always": offline, the request fails at once and the last account opens from the device.
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, networkMode: "always" });
  useEffect(() => {
    if (me.data) writeLastUser(me.data);
  }, [me.data]);
  // The signed-in account; otherwise the last one on this device: offline, server unreachable,
  // or a session that expired (its entries wait on the device for the next sign-in).
  const user = me.data ?? readLastUser();
  const userId = user?.id;

  const [opened, setOpened] = useState<Opened | null>(null);
  // Bumped when the browser drops the connection: the effect below reopens it, and stops the
  // engine bound to the dead one.
  const [reopen, setReopen] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let close = () => {};
    openAccountDb(userId, {
      onLost: () => {
        if (cancelled) return;
        setOpened(null);
        setReopen((n) => n + 1);
      },
    }).then(
      (db) => {
        if (cancelled) return db.close();
        const engine = createSyncEngine({
          userId,
          db,
          // The network part loads with the first sync: Zod stays out of the initial bundle.
          send: (request) => import("./transport").then((m) => m.postSync(request)),
          onApplied: () => void queryClient.invalidateQueries({ queryKey: ["local", userId] }),
          // D12 once a sync has landed: judged on stale sets, a session would be wrongly removed.
          onSynced: async () => {
            if (!(await closeForgotten(db, new Date()))) return;
            await queryClient.invalidateQueries({ queryKey: ["local", userId] });
            engine.schedule();
          },
        });
        const stop = engine.start();
        close = () => {
          stop();
          db.close();
        };
        setOpened({ userId, db, engine });
      },
      () => {
        if (!cancelled) setOpened({ userId });
      },
    );
    return () => {
      cancelled = true;
      close();
    };
  }, [userId, queryClient, reopen]);

  let account: Account;
  if (!user)
    account = me.isPending ? { kind: "loading" } : { kind: "signed-out", unreachable: me.isError };
  else if (opened?.userId !== user.id) account = { kind: "loading" };
  else if (!("db" in opened)) account = { kind: "unavailable", user };
  else account = { kind: "open", user, db: opened.db, engine: opened.engine };
  return <AccountContext value={account}>{children}</AccountContext>;
}

// Local reads: "always", since IndexedDB needs no network (the default would pause them offline).
const local = (account: OpenAccount, what: string) => ["local", account.user.id, what] as const;

export const useWeighings = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "weights"),
    queryFn: () => readWeights(account.db),
    networkMode: "always",
  });

export const useTarget = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "target"),
    queryFn: () => readTarget(account.db),
    networkMode: "always",
  });

export const useMeasures = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "measures"),
    queryFn: () => readMeasures(account.db),
    networkMode: "always",
  });

export const useIntake = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "intake"),
    queryFn: () => readIntake(account.db),
    networkMode: "always",
  });

export const useProfile = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "profile"),
    queryFn: () => readProfile(account.db),
    networkMode: "always",
  });

export const useSupplements = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "supplements"),
    queryFn: () => readSupplements(account.db),
    networkMode: "always",
  });

export const useSupplementLogs = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "supplementLogs"),
    queryFn: () => readSupplementLogs(account.db),
    networkMode: "always",
  });

export const useAnnotations = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "annotations"),
    queryFn: () => readAnnotations(account.db),
    networkMode: "always",
  });

export const usePending = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "pending"),
    queryFn: () => pendingCounts(account.db),
    networkMode: "always",
  });

// Every session and set, for the shared rules (removed ones included: liveSets leaves them out).
export const useHistory = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "history"),
    queryFn: () => readHistory(account.db),
    networkMode: "always",
  });

// The open session with the history it is judged on, which change together (readSessionView).
export const useSessionView = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "sessionView"),
    queryFn: () => readSessionView(account.db),
    networkMode: "always",
  });

// D12 again when Home opens: the app may have stayed open in the background since the start.
// A sync runs first (the one already going, when Home opens with the app); the engine closes
// forgotten sessions once it has landed.
export function useCloseForgotten({ engine }: OpenAccount) {
  useEffect(() => void engine.refresh(), [engine]);
}

export const useRejected = (account: OpenAccount) =>
  useQuery({
    queryKey: local(account, "rejected"),
    queryFn: () => readRejected(account.db),
    networkMode: "always",
  });

// The person has read the refused entries: the list and the banner go.
export function useClearRejected({ user, db }: OpenAccount) {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await clearRejected(db);
    await queryClient.invalidateQueries({ queryKey: ["local", user.id] });
  }, [db, queryClient, user.id]);
}

export const useSyncStatus = ({ engine }: OpenAccount) =>
  useSyncExternalStore(engine.subscribe, engine.status);

// Writes on the device first; the screen follows at once, the server when it can. Several
// changes are written together, or not at all; `active` (the open session) with them.
export function useRecord({ user, db, engine }: OpenAccount) {
  const queryClient = useQueryClient();
  return useCallback(
    async (change: Change | readonly Change[], options?: { active?: ActiveSession | null }) => {
      await recordChanges(db, "kind" in change ? [change] : change, options);
      await queryClient.invalidateQueries({ queryKey: ["local", user.id] });
      engine.schedule();
    },
    [db, engine, queryClient, user.id],
  );
}

// Starts a session of the program now; the session open on this device, if any, wins.
export function useStartWorkout({ user, db, engine }: OpenAccount) {
  const queryClient = useQueryClient();
  return useCallback(
    async (id: string, sessionCode: string, plan: Slot[]) => {
      const startedAt = new Date().toISOString();
      const open = await startWorkout(db, {
        kind: "workout",
        id,
        field: "start",
        sessionCode,
        plan,
        startedAt,
        at: startedAt,
      });
      await queryClient.invalidateQueries({ queryKey: ["local", user.id] });
      engine.schedule();
      return open;
    },
    [db, engine, queryClient, user.id],
  );
}

// ✓: the set, its queue entry and the open session in one transaction (recordSet).
export function useRecordSet({ user, db, engine }: OpenAccount) {
  const queryClient = useQueryClient();
  return useCallback(
    async (input: SetInput, active: ActiveSession) => {
      await recordSet(db, input, new Date().toISOString(), active);
      await queryClient.invalidateQueries({ queryKey: ["local", user.id] });
      engine.schedule();
    },
    [db, engine, queryClient, user.id],
  );
}
