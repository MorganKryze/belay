import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOCALES, setLocale, type Locale } from "@/i18n";
import { logout } from "@/lib/api";
import { readTheme, setTheme, type Theme } from "@/lib/theme";
import { type OpenAccount, useAccount, usePending } from "@/sync/account";

const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", fr: "Français" };
const sectionTitle = "mx-0.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase";

export function Settings() {
  const { t, i18n } = useTranslation();
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const account = useAccount();

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold">{t("settings.title")}</h1>

      <div className="flex flex-col gap-2">
        <Label htmlFor="language">{t("settings.language")}</Label>
        <Select value={i18n.language} onValueChange={(v) => setLocale(v as Locale)}>
          <SelectTrigger id="language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCALES.map((l) => (
              <SelectItem key={l} value={l} lang={l}>
                {LANGUAGE_NAMES[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="theme">{t("settings.theme")}</Label>
        <Select
          value={theme}
          onValueChange={(v) => {
            setTheme(v as Theme);
            setThemeState(v as Theme);
          }}
        >
          <SelectTrigger id="theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["light", "dark", "system"] as const).map((th) => (
              <SelectItem key={th} value={th}>
                {t(`settings.themes.${th}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {account.kind === "open" && <OpenAccountSettings account={account} />}
      {account.kind === "unavailable" && <AccountSettings pending={0} />}
    </section>
  );
}

// Shown once the device has said what is waiting, so signing out never skips the warning.
function OpenAccountSettings({ account }: { account: OpenAccount }) {
  const { data, isError } = usePending(account);
  // The read failed: the count is unknown, so sign-out stays available and always asks first.
  if (isError) return <AccountSettings pending={null} />;
  return data ? <AccountSettings pending={data.total} /> : null;
}

// Signing out keeps the entries on the device (D3); with some still waiting, say so first.
function AccountSettings({ pending }: { pending: number | null }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  // "always": offline, the request fails at once and we can say so, instead of pausing forever.
  const signOut = useMutation({ mutationFn: logout, networkMode: "always" });
  const busy = signOut.isPending || signOut.isSuccess;
  // The confirmation replaces the button: focus follows it in, and comes back on Cancel.
  const signOutButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (!confirming && wasConfirming.current) signOutButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  return (
    <div className="flex flex-col gap-2">
      <h2 className={sectionTitle}>{t("settings.account")}</h2>
      <Link
        to="/settings/profile"
        className="flex min-h-12 items-center justify-between rounded-field border border-border bg-card px-4 font-medium"
      >
        {t("profile.title")}
        <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
      </Link>
      {confirming ? (
        <div role="alert" className="flex flex-col gap-3 rounded-field bg-primary-soft p-3 text-sm">
          <p>
            {pending === null
              ? t("settings.signOutUnknown")
              : t("settings.signOutPending", { count: pending })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={(el) => el?.focus()}
              variant="outline"
              disabled={busy}
              onClick={() => signOut.mutate()}
            >
              {t("settings.signOutAnyway")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t("settings.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          ref={signOutButton}
          variant="outline"
          className="self-start"
          disabled={busy}
          onClick={() => (pending !== 0 ? setConfirming(true) : signOut.mutate())}
        >
          {t("settings.signOut")}
        </Button>
      )}
      {signOut.isError && <p role="alert">{t("settings.signOutFailed")}</p>}
    </div>
  );
}
