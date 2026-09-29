import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { fetchMe, logout } from "@/lib/api";

// What the server puts in `/?signin=` when a sign-in fails (apps/server/src/auth/routes.ts).
const SIGNIN_FAILURES = ["unavailable", "expired", "failed"] as const;
type SigninFailure = (typeof SIGNIN_FAILURES)[number];
const isSigninFailure = (v: unknown): v is SigninFailure =>
  (SIGNIN_FAILURES as readonly unknown[]).includes(v);

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
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, networkMode: "always" });
  // "always": offline, the request fails at once and we can say so, instead of pausing forever.
  const signOut = useMutation({ mutationFn: logout, networkMode: "always" });

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold">{t("app.name")}</h1>
      {failure && !me.data && <p role="alert">{t(`signin.${failure}`)}</p>}
      {me.isError && <p role="status">{t("home.serverDown")}</p>}
      {me.data === null && (
        <Button asChild>
          <a href={`/auth/login?returnTo=${encodeURIComponent("/")}`}>{t("home.signIn")}</a>
        </Button>
      )}
      {me.data && (
        <>
          <p>{t("home.greeting", { name: me.data.displayName })}</p>
          <Button
            variant="outline"
            disabled={signOut.isPending || signOut.isSuccess}
            onClick={() => signOut.mutate()}
          >
            {t("home.signOut")}
          </Button>
          {signOut.isError && <p role="alert">{t("home.signOutFailed")}</p>}
        </>
      )}
    </section>
  );
}
