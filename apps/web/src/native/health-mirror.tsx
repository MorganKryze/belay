// Keeps Apple Health in step with the open account while the iPhone app runs: a run when the
// account opens, when its sessions or weigh-ins change, when the page asks and when the app comes
// back to the foreground; the import after each landed sync. Loaded lazily by the shell's native
// module, so none of it reaches a browser.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { type OpenAccount, useHistory, useWeighings } from "@/sync/account";
import { setHealthRunner } from "./health";
import { importAfterSync } from "./health-import";
import { createHealthRunner, type HealthRunner } from "./health-run";

export function HealthMirror({ account }: { account: OpenAccount }): null {
  const queryClient = useQueryClient();
  const { db, engine } = account;
  const userId = account.user.id;
  const runner = useRef<HealthRunner | null>(null);

  useEffect(() => {
    // Only the Health state's own reads: a wider refresh would hand the run new data and start
    // it again for its own writes.
    const run = createHealthRunner(
      db,
      () => void queryClient.invalidateQueries({ queryKey: ["local", userId, "health"] }),
    );
    runner.current = run;
    setHealthRunner(run.request);
    // Back from the background: an access changed in iOS Settings is read again.
    const visible = () => {
      if (document.visibilityState === "visible") run.foreground();
    };
    document.addEventListener("visibilitychange", visible);
    const unlisten = engine.onLanded(
      () =>
        void importAfterSync({ db, engine }, () =>
          queryClient.invalidateQueries({ queryKey: ["local", userId] }),
        ),
    );
    return () => {
      run.stop();
      runner.current = null;
      setHealthRunner(null);
      document.removeEventListener("visibilitychange", visible);
      unlisten();
    };
  }, [db, engine, userId, queryClient]);

  const history = useHistory(account).data;
  const weighings = useWeighings(account).data;
  useEffect(() => {
    runner.current?.request();
  }, [db, history, weighings]);
  return null;
}
