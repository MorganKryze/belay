import { Link, useLocation } from "@tanstack/react-router";
import { CircleAlert, CircleArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useOnline } from "@/lib/online";
import { type OpenAccount, usePending, useRejected, useSyncStatus } from "@/sync/account";

const box = "flex items-start gap-2.5 rounded-field p-3 text-sm";

// Nothing when everything is sent, or offline with nothing waiting (§4.6). Mounted for good, so
// a screen reader hears it appear.
export function SyncBanner({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  const status = useSyncStatus(account);
  const online = useOnline();
  const pending = usePending(account).data ?? { weighings: 0, total: 0 };
  const rejected = useRejected(account).data?.length ?? 0;
  const { pathname } = useLocation();
  const count = pending.weighings;
  const kind =
    status === "expired" && count > 0
      ? "expired"
      : status === "failed" && pending.total > 0
        ? "failed"
        : (status === "offline" || !online) && count > 0
          ? "offline"
          : rejected > 0
            ? "rejected"
            : null;
  return (
    <div role="status">
      {kind === "offline" && (
        <div className={`${box} bg-track`}>
          <CircleArrowUp aria-hidden className="mt-px size-5 shrink-0" />
          <p>
            <b>{t("sync.offlineTitle")}</b> {t("sync.offline", { count })}
          </p>
        </div>
      )}
      {kind === "expired" && (
        <div className={`${box} bg-primary-soft`}>
          <CircleAlert aria-hidden className="mt-px size-5 shrink-0" />
          <div className="flex flex-col items-start gap-2">
            <p>
              <b>{t("sync.expiredTitle")}</b> {t("sync.expired", { count })}
            </p>
            <Button asChild>
              <a href={`/auth/login?returnTo=${encodeURIComponent(pathname)}`}>
                {t("sync.reconnect")}
              </a>
            </Button>
          </div>
        </div>
      )}
      {kind === "rejected" && (
        <div className={`${box} bg-track`}>
          <CircleAlert aria-hidden className="mt-px size-5 shrink-0" />
          <p>
            {t("sync.rejected")}{" "}
            <Link to="/settings" className="font-semibold whitespace-nowrap text-primary underline">
              {t("sync.rejectedLink")}
            </Link>
          </p>
        </div>
      )}
      {kind === "failed" && (
        <div className={`${box} bg-track`}>
          <CircleAlert aria-hidden className="mt-px size-5 shrink-0" />
          <div className="flex flex-col items-start gap-2">
            <p>{t("sync.failed")}</p>
            <Button variant="outline" onClick={() => void account.engine.sync()}>
              {t("sync.retry")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
