import "@/i18n/lazy";
import { TOOL_GROUPS, type ToolId } from "@belay/shared/tools/catalog";
import {
  CalendarRange,
  CircleDot,
  Egg,
  Gauge,
  type LucideIcon,
  Percent,
  TrendingUp,
  Weight,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { GroupedList, RowLink } from "@/components/grouped-list";
import { PageHeader } from "@/components/page-header";

// Each icon says one thing across the app: the dumbbell stays Séances' and the ruler Corps'.
const ICONS: Record<ToolId, LucideIcon> = {
  "one-rep-max": Weight,
  plates: CircleDot,
  warmup: TrendingUp,
  energy: Zap,
  protein: Egg,
  projection: CalendarRange,
  bmi: Gauge,
  "body-fat": Percent,
};

export function Tools() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title={t("tools.title")} />
      {TOOL_GROUPS.map((group) => (
        <GroupedList key={group.id} label={t(`tools.groups.${group.id}`)}>
          {group.tools.map((id) => (
            <RowLink
              key={id}
              to="/tools/$toolId"
              params={{ toolId: id }}
              icon={ICONS[id]}
              label={t(`tools.items.${id}.name`)}
              sub={t(`tools.items.${id}.hint`)}
              trailing="push"
            />
          ))}
        </GroupedList>
      ))}
      {/* Under the last list rather than as its footer: it speaks for every tool. */}
      <p className="px-4 text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground">
        {t("tools.lead")}
      </p>
    </section>
  );
}
