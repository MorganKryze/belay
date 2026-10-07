import {
  hasDoi,
  identifierHref,
  identifierLabel,
  shortAuthors,
} from "@belay/shared/science/render";
import { sourceById } from "@belay/shared/science/sources";
import { type ScienceId, TOOL_SCIENCE } from "@belay/shared/science/tools";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

const pill = "rounded-full bg-track px-2.5 py-0.5 text-xs font-semibold text-muted-foreground";
const drawer =
  "flex min-h-[50px] cursor-pointer list-none items-center justify-between gap-2 font-medium [&::-webkit-details-marker]:hidden";

function Drawer({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <details className="group border-t border-border">
      <summary className={drawer}>
        {title}
        <span className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
          {aside}
          <ChevronRight aria-hidden className="size-4 transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <div className="pb-3 text-sm">{children}</div>
    </details>
  );
}

// "How it's calculated", read in layers: the label, In short, Keep in mind, then drawers.
// Native <details>: keyboard and screen-reader support with no script. `children` goes at the
// end of the sheet (the body-fat reference set, D14). `toolId` is a tool or a rule
// ("target-rate", whose sheet is titled "How it's chosen").
export function ScienceSheet({
  toolId,
  title,
  children,
}: {
  toolId: ScienceId;
  title?: string;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const science = TOOL_SCIENCE[toolId];
  const c = i18n.language.startsWith("fr") ? science.content.fr : science.content.en;
  const labels =
    science.label === "mixed" ? (["source", "heuristic"] as const) : ([science.label] as const);
  return (
    <details className="group/sheet rounded-card border border-border bg-card px-4">
      <summary className={`${drawer} min-h-14 flex-wrap py-2 text-[17px] font-bold`}>
        <span>{title ?? t("science.title")}</span>
        <span className="flex flex-wrap gap-1.5">
          {labels.map((l) => (
            <span key={l} className={pill}>
              {t(`science.labels.${l}`)}
            </span>
          ))}
        </span>
      </summary>
      <div className="flex flex-col gap-2.5 pb-2">
        <div className="rounded-field border border-border p-3 text-sm">
          <h3 className="mb-1 text-[13px] font-semibold">{t("science.brief")}</h3>
          <p>{c.brief}</p>
        </div>
        <div className="rounded-field bg-primary-soft p-3 text-sm">
          <h3 className="mb-1 text-[13px] font-semibold text-primary-ink">{t("science.keep")}</h3>
          <ul className="list-disc pl-4">
            {c.keep.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
        {c.heuristic && (
          <div className="rounded-field bg-track p-3 text-sm">
            <h3 className="mb-1 text-[13px] font-semibold">{t("science.labels.heuristic")}</h3>
            <p>{c.heuristic}</p>
          </div>
        )}
        <div>
          <Drawer title={t("science.formula")}>
            <ul className="flex flex-col gap-1.5 tabular-nums">
              {c.formula.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Drawer>
          <Drawer
            title={t("science.sources")}
            aside={t("science.sourceCount", { count: science.sourceIds.length })}
          >
            <ul className="flex flex-col gap-3">
              {science.sourceIds.map((sid) => {
                const s = sourceById(sid);
                return (
                  <li key={sid} className="flex flex-col gap-1">
                    <span>
                      <b>
                        {shortAuthors(s)} {s.year}.
                      </b>{" "}
                      {s.title}. <i>{s.venue}</i>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {s.identifier.map((id) => {
                        const href = identifierHref(id);
                        const text = identifierLabel(id);
                        return href ? (
                          <a
                            key={text}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-11 items-center font-medium break-all text-primary underline underline-offset-2"
                          >
                            {text}
                          </a>
                        ) : (
                          <span key={text} className="text-muted-foreground">
                            {text}
                          </span>
                        );
                      })}
                      {!hasDoi(s) && (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2"
                        >
                          {t("science.record")}
                        </a>
                      )}
                      <span className={pill}>
                        {t(hasDoi(s) ? "science.doi" : "science.stable")}
                      </span>
                    </span>
                    {s.readOnThirdPartyCopy && (
                      <span className="text-muted-foreground">{t("science.thirdParty")}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Drawer>
          <Drawer title={t("science.limits")}>
            <ul className="flex list-disc flex-col gap-1.5 pl-4">
              {c.limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Drawer>
        </div>
        {children}
      </div>
    </details>
  );
}
