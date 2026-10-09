import { exerciseById } from "@belay/shared/exercises/catalog";
import { type SessionTemplate, starterProgram } from "@belay/shared/training/program";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { sessionTitle } from "@/lib/format";
import { formatSets, groupKind } from "./format";

const card = "rounded-card border border-border bg-card";

// Program (§4.5): sessions A, B and C, read only on the phone, the first one open.
export function ProgramPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(starterProgram[0]!.code);
  return (
    <div className="flex flex-col gap-3">
      {starterProgram.map((s) => (
        <Session
          key={s.code}
          session={s}
          open={open === s.code}
          onToggle={() => setOpen(open === s.code ? null : s.code)}
        />
      ))}
      <p className="mx-0.5 text-sm text-muted-foreground">{t("workouts.program.editNote")}</p>
    </div>
  );
}

function Session({
  session,
  open,
  onToggle,
}: {
  session: SessionTemplate;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${card} px-4 py-1`}>
      <h2 id={id}>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-14 w-full items-center justify-between gap-2 text-left"
        >
          <span className="flex flex-col">
            <span className="font-semibold">{sessionTitle(session.code, t)}</span>
            <span className="text-[13px] font-normal text-muted-foreground">
              {t("workouts.program.exercises", { count: session.slots.length })}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={`size-5 shrink-0 text-muted-foreground ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h2>
      {open && (
        <ul className="flex flex-col">
          {session.slots.map((slot, i) => {
            const kind = groupKind(session.slots, i);
            return (
              <li key={i} className="border-t border-border">
                <Link
                  to="/exercises/$exerciseId"
                  params={{ exerciseId: slot.exerciseId }}
                  className="flex min-h-14 flex-col justify-center py-2"
                >
                  <span className="font-medium">{exerciseById(slot.exerciseId)?.name}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {formatSets(slot)}
                    {kind && ` · ${t(`workouts.program.${kind}`)}`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
