import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { fetchMe, logout } from "@/lib/api";

export function Home() {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, networkMode: "always" });
  // "always": offline, the request fails at once and we can say so, instead of pausing forever.
  const signOut = useMutation({ mutationFn: logout, networkMode: "always" });

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold">{t("app.name")}</h1>
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
