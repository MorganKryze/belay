// The sign-in step: the iPhone app knows its instance and nobody is signed in. « Se connecter »
// opens the system sign-in sheet; « Changer d’instance » opens « Ton instance » again. Loaded on
// the phone only.
import "@/i18n/lazy";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AvatarLink } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { readInstance } from "@/lib/platform";
import { InstanceSetup } from "./instance-setup";
import type { SignInResult } from "./session";

type Failure = Exclude<SignInResult, "cancelled">;

// Splits « Sur {{host}} » around the host, so the host takes its emphasis in any language order.
const MARK = "\u0000";

export function SignInStep({ failure, unreachable }: { failure?: Failure; unreachable: boolean }) {
  const { t } = useTranslation();
  // Accueil shows this step only once an instance is stored.
  const origin = readInstance()!;
  const [shown, setShown] = useState(failure);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const signInButton = useRef<HTMLButtonElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const back = useRef(false);

  useEffect(() => {
    // Back from « Ton instance », on the link that opened it.
    if (!changing && back.current) {
      back.current = false;
      changeButton.current?.focus();
    }
  }, [changing]);

  async function press() {
    if (busy) return;
    setBusy(true);
    setShown(undefined);
    let result: SignInResult;
    try {
      const { signIn } = await import("@/native/session");
      // On success the app starts again signed in, so this never returns.
      result = await signIn("/");
    } catch {
      result = "failed";
    }
    setBusy(false);
    // Closing the sheet is no mistake: the step comes back as it was, ready for another try.
    if (result === "cancelled") signInButton.current?.focus();
    else setShown(result);
  }

  if (changing) {
    return (
      <InstanceSetup
        current={origin}
        onCancel={() => {
          back.current = true;
          setChanging(false);
        }}
      />
    );
  }

  const host = new URL(origin).host;
  const [before, after] = t("native.signIn.on", { host: MARK }).split(MARK);
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={t("app.name")}
        trailing={
          <div className="lg:hidden">
            <AvatarLink />
          </div>
        }
      >
        <p className="mt-1.5 text-body text-muted-foreground">{t("native.signIn.intro")}</p>
      </PageHeader>
      {shown && <p role="alert">{t(`signin.${shown}`)}</p>}
      {unreachable && <p role="status">{t("home.serverDown")}</p>}
      <div className="flex flex-col">
        <Button ref={signInButton} busy={busy} onClick={() => void press()}>
          {t(busy ? "native.signIn.busy" : "home.signIn")}
        </Button>
        {/* The change sits next to what it changes; when the host leaves it no room, it drops to
            its own line, its words in line with the host's. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
          <p className="min-w-0 py-1.5 text-(length:--text-secondary) leading-(--text-secondary--line-height) wrap-anywhere text-muted-foreground">
            {before}
            <strong className="font-semibold text-foreground">{host}</strong>
            {after}
          </p>
          <Button
            ref={changeButton}
            variant="text"
            className="-mx-3"
            onClick={() => setChanging(true)}
          >
            {t("native.signIn.change")}
          </Button>
        </div>
      </div>
      <Link
        to="/tools"
        className="-ml-1 inline-flex min-h-11 items-center gap-0.5 self-start font-medium text-primary"
      >
        {t("home.toolsLink")}
        <ChevronRight aria-hidden className="size-5" />
      </Link>
    </section>
  );
}
