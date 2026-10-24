import "@/i18n/lazy";
import { newId } from "@belay/shared";
import { estimatedMinutes, plannedWorkSets } from "@belay/shared/training/program";
import {
  copySlotsInto,
  cutName,
  putBack,
  renameSession,
} from "@belay/shared/training/program-edits";
import {
  MAX_ROTATION,
  rotationOf,
  SESSION_NAME_MAX,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import type { Slot } from "@belay/shared/training/workout";
import { Link } from "@tanstack/react-router";
import { Check, Copy, Eye, Pencil, Plus } from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { BackLink, PageHeader } from "@/components/page-header";
import { SyncBanner } from "@/components/sync-banner";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/weigh-in";
import {
  EditorContext,
  type EditorState,
  isMac,
  LETTERS,
  type PlacedSession,
  placedOf,
  titleOf,
  useEditor,
} from "@/editor/editor-context";
import { ProgramSwitcher } from "@/editor/program-switcher";
import { SessionCard } from "@/editor/session-card";
import { chipId, chipName, PANEL, SessionChips, spokenName } from "@/editor/session-chips";
import { SessionMenu } from "@/editor/session-menu";
import { AddedHelp, GridHelp, SlotGrid } from "@/editor/slot-grid";
import { useEdits } from "@/editor/use-edits";
import i18n from "@/i18n";
import en from "@/i18n/editor/en.json";
import fr from "@/i18n/editor/fr.json";
import { sessionName, sessionTitle } from "@/lib/format";
import { type OpenAccount, useAccount, useProgram } from "@/sync/account";

// The editor's strings load with it, deep and never replacing a key, as the lazy screens' do.
i18n.addResourceBundle("en", "translation", en, true, false);
i18n.addResourceBundle("fr", "translation", fr, true, false);

// The program editor, a computer's page: the active program's sessions as chips, the shown one's
// card with its table, each value saved as soon as it changes.
export function ProgramEditor() {
  const account = useAccount();
  if (account.kind === "loading") return null;
  return account.kind === "open" ? <WithData account={account} /> : <Header />;
}

// The title, and beside it, once the programs are read, the selector of the active program.
function Header({ switcher = false, saved = false }: { switcher?: boolean; saved?: boolean }) {
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
        <div className="flex min-w-0 flex-1 items-center">{switcher && <ProgramSwitcher />}</div>
      }
    >
      {saved && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Check aria-hidden className="size-4" />
          {t("editor.saved")}
        </p>
      )}
    </PageHeader>
  );
}

function WithData({ account }: { account: OpenAccount }) {
  const program = useProgram(account).data;
  return program ? <Editor account={account} programs={program.programs} /> : null;
}

function Editor({ account, programs }: { account: OpenAccount; programs: StoredPrograms }) {
  const { t } = useTranslation();
  // The session asked for, then the one to show while it is gone.
  const [show, setShow] = useState<readonly string[]>([]);
  const [said, announce] = useState("");
  const [searchFor, setSearchFor] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const edits = useEdits(account, programs);
  useUndoKey(edits.undo);
  const state = useMemo((): EditorState => {
    const program = programs.programs.find((x) => x.id === programs.activeId && !x.removed);
    const { rotation, aside } = placedOf(programs);
    const all = [...rotation, ...aside];
    const shown = program
      ? (show.flatMap((id) => all.filter((p) => p.session.id === id))[0] ??
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
      show: (id, otherwise) => {
        setShow(otherwise ? [id, otherwise] : [id]);
        setAdded((was) => (was === id ? was : null));
      },
      announce,
      search: { for: searchFor, request: setSearchFor, done: () => setSearchFor(null) },
      added,
      markAdded: setAdded,
      edits,
    };
  }, [account, programs, show, searchFor, added, edits]);
  return (
    <EditorContext.Provider value={state}>
      <section className="flex flex-col gap-4">
        <Header switcher saved={edits.saved} />
        <SyncBanner account={account} />
        <p role="status" aria-live="polite" className="sr-only">
          {said}
        </p>
        {state.program ? (
          <>
            <SessionChips />
            {state.shown && <Shown placed={state.shown} />}
          </>
        ) : (
          <p className="text-body">{t("editor.noActive")}</p>
        )}
      </section>
      <Toast toast={edits.toast} onDone={edits.dismiss} />
    </EditorContext.Provider>
  );
}

// ⌘ Z on a Mac, Ctrl Z elsewhere, undoes the last edit of this visit; in a field it is the
// field's own undo of its typing.
function useUndoKey(undo: () => Promise<boolean>) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mac = isMac();
      if (e.key.toLowerCase() !== "z" || e.shiftKey || e.altKey) return;
      if (!(mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]:not([contenteditable=false])")) return;
      e.preventDefault();
      void undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);
}

// The shown session's card: its title with the pencil that names it in place, its size, the way
// to its preview (or, set aside, back into the rotation) and its menu, then its table, or for a
// session with no exercise the sessions it can start from.
function Shown({ placed }: { placed: PlacedSession }) {
  const { t } = useTranslation();
  const { programs, rotation, edits, added } = useEditor();
  const id = placed.session.id;
  // The session being named, so another session shown closes the field.
  const [renaming, setRenaming] = useState<string | null>(null);
  const naming = renaming === id;
  const pencil = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  // A field closed hands the focus back to the pencil once it is drawn again.
  const refocus = useRef(false);
  const close = () => {
    refocus.current = true;
    setRenaming(null);
  };
  useLayoutEffect(() => {
    if (naming || !refocus.current) return;
    refocus.current = false;
    pencil.current?.focus();
  }, [naming]);
  // The size counts the normal section, as the session starts in a week with climbing.
  const plan: Slot[] = placed.slots.map(({ rule, ...s }) => (rule ? { ...s, rule } : s));
  const empty = placed.slots.length === 0 && placed.noClimbing.length === 0;
  const size = empty
    ? t("editor.card.newSession")
    : [
        t("editor.card.exercises", { count: plan.length }),
        t("editor.card.sets", { count: plannedWorkSets(plan) }),
        t("editor.card.minutes", { count: estimatedMinutes({ slots: plan }) }),
      ].join(" · ");
  // The preview opens a rotation session by its id, as the rotation that starts sessions holds it,
  // which leaves empty ones out.
  const previewed = placed.letter !== null && rotationOf(programs).some((r) => r.sessionId === id);

  const save = (value: string) => {
    const name = cutName(value, SESSION_NAME_MAX);
    if (name === (placed.session.name ?? chipName(placed, t))) return close();
    void edits.record((_, at) => renameSession(id, name, at)).then((ok) => ok && close());
  };
  const back = () => {
    const code = LETTERS[rotation.length];
    void edits.record((p, at) => putBack(p, id, at), {
      toast: t("editor.toast.putBack", { name: spokenName(placed, t), code }),
      refused: t(
        rotation.length >= MAX_ROTATION ? "editor.limit.rotation" : "editor.toast.refused",
      ),
    });
  };

  return (
    <div role="tabpanel" id={PANEL} aria-labelledby={chipId(id)}>
      <SessionCard
        heading={
          <>
            {naming ? (
              <NameField placed={placed} hintId={hintId} onSave={save} onCancel={close} />
            ) : (
              <div className="flex min-w-0 items-center gap-1">
                <h2 className="truncate text-title-card">{titleOf(placed, t)}</h2>
                <button
                  ref={pencil}
                  type="button"
                  aria-label={t("editor.card.rename")}
                  onClick={() => setRenaming(id)}
                  className="grid size-11 shrink-0 place-items-center rounded-control text-muted-foreground outline-ring focus-visible:outline-2 -outline-offset-2 hover:bg-(--press-tint)"
                >
                  <Pencil aria-hidden className="size-5" />
                </button>
              </div>
            )}
            <p className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">{size}</p>
          </>
        }
        actions={
          <>
            {placed.letter === null ? (
              <Button variant="secondary" onClick={back}>
                <Plus aria-hidden />
                {t("editor.card.putBack")}
              </Button>
            ) : (
              previewed && (
                <Button asChild variant="secondary">
                  <Link to="/workouts/session/$code" params={{ code: id }}>
                    <Eye aria-hidden />
                    {t("editor.card.see")}
                  </Link>
                </Button>
              )
            )}
            <SessionMenu placed={placed} onRename={() => setRenaming(id)} />
          </>
        }
      >
        {empty ? <StartFrom placed={placed} /> : <SlotGrid placed={placed} />}
      </SessionCard>
      {naming ? (
        <p id={hintId} className="min-h-11 px-1 py-2.5 text-sm text-muted-foreground">
          {t("editor.card.nameHint")}
        </p>
      ) : placed.letter === null ? (
        <>
          <p className="px-1 pt-2.5 text-sm text-muted-foreground">{t("editor.asideHint")}</p>
          <GridHelp />
        </>
      ) : added === id && empty ? (
        <AddedHelp code={placed.letter} />
      ) : (
        <GridHelp />
      )}
    </div>
  );
}

// The name in place of the title, « Séance D · » fixed before it: Enter or a click away saves it
// trimmed (empty means no name), Escape leaves it as it was.
function NameField({
  placed,
  hintId,
  onSave,
  onCancel,
}: {
  placed: PlacedSession;
  hintId: string;
  onSave(value: string): void;
  onCancel(): void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(
    placed.letter === null ? sessionName(placed.session, t) : (chipName(placed, t) ?? ""),
  );
  // Enter and Escape have answered: the blur that follows them saves nothing more.
  const answered = useRef(false);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      answered.current = true;
      onSave(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      answered.current = true;
      onCancel();
    }
  };
  return (
    <label className="flex min-h-11 w-[30rem] max-w-full items-center rounded-control bg-surface px-3 text-title-card ring-[1.5px] ring-primary-ink ring-inset">
      {placed.letter !== null && (
        <span className="shrink-0 whitespace-pre text-muted-foreground">
          {`${sessionTitle(placed.letter, t, null)} · `}
        </span>
      )}
      <input
        ref={(el) => {
          if (!el || document.activeElement === el) return;
          el.focus();
          el.select();
        }}
        value={value}
        maxLength={SESSION_NAME_MAX}
        aria-label={t("editor.card.nameLabel")}
        aria-describedby={hintId}
        autoComplete="off"
        onChange={(e) => {
          answered.current = false;
          setValue(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!answered.current) onSave(value);
        }}
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
      />
    </label>
  );
}

// A session with no exercise: the search above, or a start from another session of the program,
// whose exercises and values it copies.
function StartFrom({ placed }: { placed: PlacedSession }) {
  const { t } = useTranslation();
  const { rotation, edits } = useEditor();
  const sources = rotation.filter(
    (p) => p.session.id !== placed.session.id && p.slots.length + p.noClimbing.length > 0,
  );
  const copy = (sourceId: string) =>
    void edits.record((p, at) => copySlotsInto(p, placed.session.id, sourceId, newId, at), {
      refused: t("editor.limit.slots"),
    });
  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 pt-5 pb-4">
      <div className="flex flex-col gap-0.5">
        <p className="text-body font-semibold text-foreground">{t("editor.empty.title")}</p>
        <p className="text-sm text-muted-foreground">{t("editor.empty.text")}</p>
      </div>
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sources.map((p) => {
            const label = chipName(p, t);
            const session =
              label === null ? p.letter! : t("editor.chips.named", { code: p.letter, name: label });
            return (
              <button
                key={p.session.id}
                type="button"
                aria-label={t("editor.empty.from", { session })}
                onClick={() => copy(p.session.id)}
                className="inline-flex min-h-11 items-center gap-2 rounded-control bg-track px-4 text-body font-semibold text-foreground outline-ring focus-visible:outline-2 -outline-offset-2"
              >
                <Copy aria-hidden className="size-5 text-muted-foreground" />
                {session}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
