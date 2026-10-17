import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function NotFound() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-title-lg">{t("fallback.notFoundTitle")}</h1>
      <p>{t("fallback.notFoundBody")}</p>
      <Button asChild variant="secondary" className="self-start">
        <Link to="/">{t("fallback.backHome")}</Link>
      </Button>
    </section>
  );
}

// Also what a lazy page shows when its chunk failed to load (an update removed the old file):
// a reload fetches the new one.
export function RouteError() {
  const { t } = useTranslation();
  return (
    <section role="alert" className="flex flex-col gap-4">
      <h1 className="text-title-lg">{t("fallback.errorTitle")}</h1>
      <p>{t("fallback.errorBody")}</p>
      <Button className="self-start" onClick={() => window.location.reload()}>
        {t("fallback.reload")}
      </Button>
    </section>
  );
}
