import "@/i18n/lazy";
import { estimatedMinutes, plannedWorkSets } from "@belay/shared/training/program";
import {
  isSeedSession,
  rotationOf,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import type { Slot } from "@belay/shared/training/workout";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { type KeyboardEvent, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackLink, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  EditorContext,
  type EditorState,
  type PlacedSession,
  placedOf,
  titleOf,
  useEditor,
} from "@/editor/editor-context";
import { SessionCard } from "@/editor/session-card";
import { SlotGrid } from "@/editor/slot-grid";
import i18n from "@/i18n";
import en from "@/i18n/editor/en.json";
import fr from "@/i18n/editor/fr.json";
import { programName, sessionName } from "@/lib/format";
import { type OpenAccount, useAccount, useProgram } from "@/sync/account";

// The editor's strings load with it, deep and never replacing a key, as the lazy screens' do.
i18n.addResourceBundle("en", "translation", en, true, false);
i18n.addResourceBundle("fr", "translation", fr, true, false);

// The program editor, a computer's page: the active program's sessions as chips, the shown one's
// card with its table. Read only for now.
export function ProgramEditor() {
  const account = useAccount();
  if (account.kind === "loading") return null;
  return account.kind === "open" ? <WithData account={account} /> : <Header name={null} />;
}

function Header({ name }: { name: string | null }) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t("editor.title")}
      back={
        <BackLink to="/workouts" search={{ tab: "program" }}>
          {t("workouts.tabs.program")}
        </BackLink>
      }
      trailing={
        <div className="flex min-w-0 flex-1 items-center">
          {name && <span className="truncate text-body font-semibold">{name}</span>}
        </div>
      }
    />
  );
}

function WithData({ account }: { account: OpenAccount }) {
  const program = useProgram(account).data;
  return program ? <Editor account={account} programs={program.programs} /> : null;
}

function Editor({ account, programs }: { account: OpenAccount; programs: StoredPrograms }) {
  const { t } = useTranslation();
  const [show, setShow] = useState<string | null>(null);
  const [said, announce] = useState("");
  const [searchFor, setSearchFor] = useState<string | null>(null);
  const state = useMemo((): EditorState => {
    const program = programs.programs.find((x) => x.id === programs.activeId && !x.removed);
    const { rotation, aside } = placedOf(programs);
    const shown = program
      ? ([...rotation, ...aside].find((p) => p.session.id === show) ??
        rotation[0] ??
        aside[0] ??
        null)
      : null;
    return {
      account,
      programs,
      program: program ?? null,
      rotation,
      aside,
      shown,
      show: setShow,
      announce,
      search: { for: searchFor, request: setSearchFor, done: () => setSearchFor(null) },
    };
  }, [account, programs, show, searchFor]);
  return (
    <EditorContext.Provider value={state}>
      <section className="flex flex-col gap-4">
        <Header name={state.program && programName(state.program, t)} />
        <p role="status" aria-live="polite" className="sr-only">
          {said}
        </p>
        {state.program ? (
          <>
            <div className="flex flex-col gap-2">
              <Chips />
              <p className="text-sm text-muted-foreground">{t("editor.hint")}</p>
            </div>
            {state.shown && <Shown placed={state.shown} />}
          </>
        ) : (
          <p className="text-body">{t("editor.noActive")}</p>
        )}
      </section>
    </EditorContext.Provider>
  );
}

const chipBox =
  "inline-flex min-h-11 items-center gap-2 rounded-control px-4 text-body outline-ring focus-visible:outline-2 -outline-offset-2";
const chipOn = `${chipBox} bg-primary-soft font-semibold text-primary-ink ring-[1.5px] ring-primary-ink ring-inset`;

// The rotation's chips, lettered by place, then the set-aside ones, outlined and without a letter.
// Each list is one tab stop; a chip shows its session as soon as it has focus, and ← → move.
function Chips() {
  const { t } = useTranslation();
  const { rotation, aside } = useEditor();
  const asideId = useId();
  return (
    <>
      <div role="tablist" aria-label={t("editor.chips.label")} className="flex flex-wrap gap-2">
        <ChipList list={rotation} />
      </div>
      {aside.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span id={asideId} className="px-0.5 text-sm font-semibold text-muted-foreground">
            {t("editor.chips.aside")}
          </span>
          <div role="tablist" aria-labelledby={asideId} className="flex flex-wrap gap-2">
            <ChipList list={aside} />
          </div>
        </div>
      )}
    </>
  );
}

// The panel the chips control, named after the shown chip.
const PANEL = "program-editor-session";
const chipId = (sessionId: string) => `program-editor-chip-${sessionId}`;

// A rotation session's name: its own, else a starting session's translated one; none for a session
// left without a name, whose chip shows its letter alone.
function chipName({ session }: PlacedSession, t: TFunction): string | null {
  return session.name !== null || isSeedSession(session.id) ? sessionName(session, t) : null;
}

function move(e: KeyboardEvent<HTMLButtonElement>) {
  const tabs = [...e.currentTarget.parentElement!.querySelectorAll<HTMLElement>("[role=tab]")];
  const at = tabs.indexOf(e.currentTarget);
  const to =
    e.key === "ArrowRight"
      ? (at + 1) % tabs.length
      : e.key === "ArrowLeft"
        ? (at - 1 + tabs.length) % tabs.length
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? tabs.length - 1
            : null;
  if (to === null) return;
  e.preventDefault();
  tabs[to]!.focus();
}

function ChipList({ list }: { list: readonly PlacedSession[] }) {
  const { t } = useTranslation();
  const { shown, show } = useEditor();
  const holdsShown = list.some((p) => p === shown);
  return list.map((p, i) => {
    const on = p === shown;
    const name = p.letter === null ? null : chipName(p, t);
    return (
      <button
        key={p.session.id}
        id={chipId(p.session.id)}
        type="button"
        role="tab"
        aria-selected={on}
        aria-controls={on ? PANEL : undefined}
        aria-label={
          p.letter !== null && name !== null
            ? t("editor.chips.named", { code: p.letter, name })
            : undefined
        }
        tabIndex={on || (!holdsShown && i === 0) ? 0 : -1}
        onFocus={() => show(p.session.id)}
        onClick={() => show(p.session.id)}
        onKeyDown={move}
        className={
          on
            ? chipOn
            : p.letter === null
              ? `${chipBox} font-medium text-foreground ring-[1.5px] ring-input ring-inset`
              : `${chipBox} bg-track font-semibold text-muted-foreground`
        }
      >
        {p.letter === null ? (
          sessionName(p.session, t)
        ) : (
          <>
            <span className={on ? "font-bold" : "font-bold text-foreground"}>{p.letter}</span>
            {name}
          </>
        )}
      </button>
    );
  });
}

// The shown session's card: its title and size, the way to its preview, its table.
function Shown({ placed }: { placed: PlacedSession }) {
  const { t } = useTranslation();
  const { programs } = useEditor();
  // The size counts the normal section, as the session starts in a week with climbing.
  const plan: Slot[] = placed.slots.map(({ rule, ...s }) => (rule ? { ...s, rule } : s));
  const size = [
    t("editor.card.exercises", { count: plan.length }),
    t("editor.card.sets", { count: plannedWorkSets(plan) }),
    t("editor.card.minutes", { count: estimatedMinutes({ slots: plan }) }),
  ].join(" · ");
  // The preview opens a session by its letter in the rotation that starts sessions, which leaves
  // empty ones out; a set-aside or empty session has no preview.
  const code =
    placed.letter === null
      ? undefined
      : rotationOf(programs).find((r) => r.sessionId === placed.session.id)?.code;
  return (
    <div role="tabpanel" id={PANEL} aria-labelledby={chipId(placed.session.id)}>
      <SessionCard
        heading={
          <>
            <h2 className="truncate text-title-card">{titleOf(placed, t)}</h2>
            <p className="text-sm text-muted-foreground tabular-nums">{size}</p>
          </>
        }
        actions={
          code && (
            <Button asChild variant="secondary">
              <Link to="/workouts/session/$code" params={{ code }}>
                {t("editor.card.see")}
              </Link>
            </Button>
          )
        }
      >
        <SlotGrid placed={placed} />
      </SessionCard>
    </div>
  );
}
