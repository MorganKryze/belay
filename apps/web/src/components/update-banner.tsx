import { CircleArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { reloadToUpdate, useUpdateReady } from "@/lib/update";

// Nothing until a new version waits. Mounted for good, so a screen reader hears it appear. It
// never reloads on its own: only the button does.
export function UpdateBanner() {
  const { t } = useTranslation();
  const ready = useUpdateReady();
  // Empty, it is sr-only: out of the layout flow, so it adds no gap.
  return (
    <div role="status" className={ready ? undefined : "sr-only"}>
      {ready && (
        <div className="flex animate-drop-in items-center gap-2.5 rounded-field bg-track p-3 text-sm">
          <CircleArrowUp aria-hidden className="size-5 shrink-0" />
          <p className="flex-1 font-semibold">{t("update.available")}</p>
          <Button variant="secondary" onClick={reloadToUpdate}>
            {t("update.reload")}
          </Button>
        </div>
      )}
    </div>
  );
}
