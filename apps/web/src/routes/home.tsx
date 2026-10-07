import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncBanner } from "@/components/sync-banner";
import { Button } from "@/components/ui/button";
import { type OpenAccount, useAccount } from "@/sync/account";

// What the server puts in `/?signin=` when a sign-in fails (apps/server/src/auth/routes.ts).
const SIGNIN_FAILURES = ["unavailable", "expired", "failed"] as const;
type SigninFailure = (typeof SIGNIN_FAILURES)[number];
const isSigninFailure = (v: unknown): v is SigninFailure =>
  (SIGNIN_FAILURES as readonly unknown[]).includes(v);

const title = "text-[26px] leading-tight font-bold tracking-tight";

export function Home() {
  const { t } = useTranslation();
  const { signin } = useSearch({ from: "/" });
  const navigate = useNavigate();
  // Read once: the param is stripped from the URL right below, and the message outlives it.
  const [failure] = useState(() => (isSigninFailure(signin) ? signin : undefined));
  useEffect(() => {
    // Also strips an unknown value. Replaced, not pushed, so Back never returns to it and a
    // reload does not show the message again.
    if (signin !== undefined) {
      void navigate({ to: "/", search: (prev) => ({ ...prev, signin: undefined }), replace: true });
    }
  }, [signin, navigate]);
  const account = useAccount();

  if (account.kind === "open") return <SignedInHome account={account} />;
  return (
    <section className="flex flex-col gap-4">
      {account.kind === "unavailable" ? (
        <h1 className={title}>{t("home.greeting", { name: account.user.displayName })}</h1>
      ) : (
        <h1 className="text-3xl font-semibold">{t("app.name")}</h1>
      )}
      {failure && account.kind === "signed-out" && <p role="alert">{t(`signin.${failure}`)}</p>}
      {account.kind === "signed-out" && account.unreachable && (
        <p role="status">{t("home.serverDown")}</p>
      )}
      {account.kind === "unavailable" && <p role="status">{t("account.unavailable")}</p>}
      {account.kind === "signed-out" && (
        <Button asChild>
          <a href={`/auth/login?returnTo=${encodeURIComponent("/")}`}>{t("home.signIn")}</a>
        </Button>
      )}
      {account.kind !== "loading" && (
        <Link
          to="/tools"
          className="-ml-1 inline-flex min-h-11 items-center gap-0.5 self-start font-medium text-primary"
        >
          {t("home.toolsLink")}
          <ChevronRight aria-hidden className="size-5" />
        </Link>
      )}
    </section>
  );
}

function SignedInHome({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h1 className={title}>{t("home.greeting", { name: account.user.displayName })}</h1>
      <SyncBanner account={account} />
    </section>
  );
}
