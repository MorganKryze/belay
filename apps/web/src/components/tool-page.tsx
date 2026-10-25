import "@/i18n/lazy";
import type { ToolId } from "@belay/shared/tools/catalog";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BackLink, PageHeader } from "./page-header";
import { ScienceSheet } from "./science-sheet";

// Every tool page: the shared header with its back chevron, title, lead, the tool, then "How it's calculated" at the bottom.
export function ToolPage({
  title,
  lead,
  toolId,
  backTo = "tools",
  sheetExtra,
  children,
}: {
  title: string;
  lead?: string;
  toolId?: ToolId;
  backTo?: "tools" | "plates";
  sheetExtra?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={title}
        back={
          backTo === "tools" ? (
            <BackLink to="/tools">{t("tools.back")}</BackLink>
          ) : (
            <BackLink to="/tools/$toolId" params={{ toolId: "plates" }}>
              {t("tools.items.plates.name")}
            </BackLink>
          )
        }
      >
        {lead && <p className="mt-1 text-sm text-muted-foreground">{lead}</p>}
      </PageHeader>
      {children}
      {toolId && <ScienceSheet toolId={toolId}>{sheetExtra}</ScienceSheet>}
    </section>
  );
}
