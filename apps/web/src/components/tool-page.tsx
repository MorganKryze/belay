import type { ToolId } from "@belay/shared/tools/catalog";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScienceSheet } from "./science-sheet";

const back = "-ml-1 inline-flex min-h-11 items-center gap-0.5 font-medium text-primary";

// Every tool page: back link, title, lead, the tool, then "How it's calculated" at the bottom.
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
      <div>
        {backTo === "tools" ? (
          <Link to="/tools" className={back}>
            <ChevronLeft aria-hidden className="size-5" />
            {t("tools.back")}
          </Link>
        ) : (
          <Link to="/tools/$toolId" params={{ toolId: "plates" }} className={back}>
            <ChevronLeft aria-hidden className="size-5" />
            {t("tools.items.plates.name")}
          </Link>
        )}
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">{title}</h1>
        {lead && <p className="mt-1 text-sm text-muted-foreground">{lead}</p>}
      </div>
      {children}
      {toolId && <ScienceSheet toolId={toolId}>{sheetExtra}</ScienceSheet>}
    </section>
  );
}
