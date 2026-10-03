import { TOOL_GROUPS, type ToolId } from "@belay/shared/tools/catalog";
import { Link } from "@tanstack/react-router";
import {
  CalendarRange,
  ChevronRight,
  CircleDot,
  Dumbbell,
  Egg,
  type LucideIcon,
  Percent,
  Ruler,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";

const ICONS: Record<ToolId, LucideIcon> = {
  "one-rep-max": Dumbbell,
  plates: CircleDot,
  warmup: TrendingUp,
  energy: Zap,
  protein: Egg,
  projection: CalendarRange,
  bmi: Ruler,
  "body-fat": Percent,
};

export function Tools() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col">
      <h1 className="text-[26px] leading-tight font-bold tracking-tight">{t("tools.title")}</h1>
      <p className="mt-1 mb-1 text-sm text-muted-foreground">{t("tools.lead")}</p>
      {TOOL_GROUPS.map((group) => (
        <div key={group.id}>
          <h2 className="mx-0.5 mt-3.5 mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {t(`tools.groups.${group.id}`)}
          </h2>
          <ul className="overflow-hidden rounded-2xl border border-border bg-card">
            {group.tools.map((id) => {
              const Icon = ICONS[id];
              return (
                <li key={id} className="border-t border-border first:border-t-0">
                  <Link
                    to="/tools/$toolId"
                    params={{ toolId: id }}
                    className="flex min-h-15 items-center gap-3 px-3 py-2"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-chip bg-primary-soft text-primary">
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <span className="flex flex-col">
                      <span className="font-semibold">{t(`tools.items.${id}.name`)}</span>
                      <span className="text-[13px] leading-snug text-muted-foreground">
                        {t(`tools.items.${id}.hint`)}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="ml-auto size-5 shrink-0 text-muted-foreground"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
