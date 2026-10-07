import { useTranslation } from "react-i18next";
import { SyncBanner } from "@/components/sync-banner";
import { Button } from "@/components/ui/button";
import { type Account, type OpenAccount, useAccount } from "@/sync/account";

const title = "text-[26px] leading-tight font-bold tracking-tight";

// The Body tab: always in the bar; tracking needs an account (D5), the tools do not.
export function Body() {
  const account = useAccount();
  return account.kind === "open" ? <BodyPage account={account} /> : <NoAccount account={account} />;
}

function NoAccount({ account }: { account: Exclude<Account, OpenAccount> }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h1 className={title}>{t("body.title")}</h1>
      {account.kind === "unavailable" && <p>{t("account.unavailable")}</p>}
      {account.kind === "signed-out" && (
        <>
          <p>{t("body.signedOut")}</p>
          <Button asChild className="self-start">
            <a href={`/auth/login?returnTo=${encodeURIComponent("/body")}`}>{t("home.signIn")}</a>
          </Button>
        </>
      )}
    </section>
  );
}

function BodyPage({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h1 className={title}>{t("body.title")}</h1>
      <SyncBanner account={account} />
    </section>
  );
}
