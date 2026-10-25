import { newId } from "@belay/shared";
import { toISODate } from "@belay/shared/body/dates";
import {
  chooseActive,
  cutName,
  neighbourOf,
  newProgram,
  type ProgramStart,
  programOrder,
  removeProgramFor,
  renameProgram,
} from "@belay/shared/training/program-edits";
import { plannedNext } from "@belay/shared/training/schedule";
import {
  byPosition,
  isProgramName,
  MAX_PROGRAMS,
  type Program,
  PROGRAM_NAME_MAX,
  rotationOf,
  SEED,
  SEED_PROGRAM_ID,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import type { TFunction } from "i18next";
import {
  Check,
  ChevronDown,
  Copy,
  Dumbbell,
  type LucideIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionSheet } from "@/components/action-sheet";
import { programName, sessionName } from "@/lib/format";
import { useHistory } from "@/sync/account";
import { useEditor } from "./editor-context";

// What a menu row asks for once the menu has closed and given the focus back: the name field
// and the sheet each take the focus themselves, so they open only after.
type After = { kind: "rename"; program: Program } | { kind: "remove"; program: Program };

// Radix hides the page behind an open menu with aria-hidden only, so its controls stay focusable
// behind the menu. Marking the app's root inert takes them out of reach too, as MenuRow does.
const root = () => document.getElementById("root");

const liveSessions = (p: StoredPrograms, programId: string) =>
  p.sessions.filter((s) => s.programId === programId && !s.removed);

// A rotation session as the toast and the menu say it: « A · Push », or its letter alone.
const shortTitle = (s: { code: string; id: string; name: string | null }, t: TFunction) => {
  const name =
    s.name !== null || SEED.sessions.some((x) => x.id === s.id) ? sessionName(s, t) : null;
  return name === null ? s.code : t("editor.chips.named", { code: s.code, name });
};

const item =
  "flex min-h-14 w-full cursor-default items-center gap-3 rounded-chip px-3 py-1.5 text-left text-body outline-ring select-none data-highlighted:bg-(--press-tint) focus-visible:outline-2 -outline-offset-2";
const content =
  "z-50 max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto rounded-field bg-popover p-1 text-popover-foreground shadow-float data-[state=closed]:animate-fade-out data-[state=open]:animate-dialog-in dark:border dark:border-border";
const label = "px-3 pt-2.5 pb-1.5 text-sm font-semibold text-muted-foreground";
const separator = "mx-3 my-1 h-px bg-border";

function Row({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub?: ReactNode }) {
  return (
    <>
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{title}</span>
        {sub && <span className="truncate text-sm text-muted-foreground">{sub}</span>}
      </span>
    </>
  );
}

// Beside the page's title: the active program's name, opening the menu of the account's programs.
// Choosing one activates it, with an undo; the menu also creates, renames in place and removes.
export function ProgramSwitcher() {
  const { t } = useTranslation();
  const { account, programs, program, edits } = useEditor();
  const workouts = useHistory(account).data?.workouts ?? [];
  const [menu, setMenu] = useState<"programs" | "new" | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Program | null>(null);
  const after = useRef<After | null>(null);
  const hintId = useId();
  const order = programOrder(programs);
  const name = program ? programName(program, t) : t("editor.programs.label");
  const open = menu !== null;

  // Unmounted while open (a navigation): the page must not stay out of reach.
  useEffect(() => {
    if (!open) return;
    return () => root()?.removeAttribute("inert");
  }, [open]);

  const choose = (id: string) => {
    if (id === programs.activeId) return;
    const chosen = order.find((p) => p.id === id);
    if (!chosen) return;
    // The next session as the new program plans it from now, as Accueil will.
    const now = new Date();
    const at = now.toISOString();
    const chosenPrograms = { ...programs, activeId: id, activeAt: at };
    const next = plannedNext(workouts, chosenPrograms, rotationOf(chosenPrograms), toISODate(now));
    const toast = next
      ? t("editor.toast.switched", {
          program: programName(chosen, t),
          session: shortTitle({ code: next.code, id: next.sessionId, name: next.name }, t),
        })
      : t("editor.toast.switchedNone", { program: programName(chosen, t) });
    void edits.record((p, when) => chooseActive(p, id, when), { toast });
  };

  const create = async (start: ProgramStart, title: string) => {
    const named = cutName(title, PROGRAM_NAME_MAX) ?? t("editor.programs.newName");
    // The program's id is the first one the rule asks for.
    let created: string | null = null;
    const ids = () => {
      const id = newId();
      created ??= id;
      return id;
    };
    const full = order.length >= MAX_PROGRAMS;
    const ok = await edits.record((p, at) => newProgram(p, start, named, ids, at), {
      toast: t("editor.toast.created", { program: named }),
      refused: t(full ? "editor.limit.programs" : "editor.limit.sessions"),
    });
    if (ok && created) setRenaming({ id: created, name: named });
  };

  const starterSub = SEED.sessions
    .filter((s) => s.programId === SEED_PROGRAM_ID && !s.removed)
    .sort(byPosition)
    .map((s, i) =>
      shortTitle({ code: "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i]!, id: s.id, name: s.name }, t),
    )
    .join(", ");

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {renaming ? (
        <NameField
          key={renaming.id}
          initial={renaming.name}
          hintId={hintId}
          onSave={(value) => {
            const id = renaming.id;
            void edits
              .record((_, at) => {
                // Refused here, as the rules would, so a control character reads as a refusal
                // rather than as the program having changed elsewhere.
                const name = value || null;
                return isProgramName(name) ? renameProgram(id, name, at) : null;
              })
              .then((ok) => ok && setRenaming(null));
          }}
          onCancel={() => setRenaming(null)}
        />
      ) : (
        <DropdownMenu.Root
          open={open}
          onOpenChange={(o) => {
            // Freed here, synchronously, before Radix gives the focus back to the selector: an
            // inert selector cannot take it.
            if (o) root()?.setAttribute("inert", "");
            else root()?.removeAttribute("inert");
            setMenu(o ? "programs" : null);
          }}
        >
          <DropdownMenu.Trigger
            aria-label={t("editor.programs.selector", { name })}
            className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-control bg-track px-4 text-body font-semibold text-foreground outline-ring focus-visible:outline-2 -outline-offset-2 data-[state=open]:ring-[1.5px] data-[state=open]:ring-primary-ink data-[state=open]:ring-inset"
          >
            <span className="truncate">{name}</span>
            <ChevronDown aria-hidden className="size-4 shrink-0" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              key={menu ?? "programs"}
              align="start"
              sideOffset={4}
              collisionPadding={8}
              className={`${content} ${menu === "new" ? "w-[400px]" : "w-[340px]"} max-w-[calc(100vw-1rem)]`}
              onCloseAutoFocus={(e) => {
                const next = after.current;
                after.current = null;
                if (!next) return;
                e.preventDefault();
                if (next.kind === "rename")
                  setRenaming({ id: next.program.id, name: programName(next.program, t) });
                else setRemoving(next.program);
              }}
            >
              {menu === "new" ? (
                <>
                  <DropdownMenu.Label className={label}>
                    {t("editor.programs.newLabel")}
                  </DropdownMenu.Label>
                  <DropdownMenu.Item
                    className={item}
                    onSelect={() => void create({ kind: "empty" }, t("editor.programs.newName"))}
                  >
                    <Row
                      icon={Plus}
                      title={t("editor.programs.empty")}
                      sub={t("editor.programs.emptySub")}
                    />
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className={item}
                    onSelect={() => void create({ kind: "starter" }, t("program.starter"))}
                  >
                    <Row icon={Dumbbell} title={t("program.starter")} sub={starterSub} />
                  </DropdownMenu.Item>
                  {program && (
                    <DropdownMenu.Item
                      className={item}
                      onSelect={() =>
                        void create(
                          { kind: "copy", from: program.id },
                          t("editor.programs.copyName", { name: programName(program, t) }),
                        )
                      }
                    >
                      <Row
                        icon={Copy}
                        title={t("editor.programs.copy", { name: programName(program, t) })}
                        sub={t("editor.programs.copySub")}
                      />
                    </DropdownMenu.Item>
                  )}
                </>
              ) : (
                <>
                  <DropdownMenu.Label className={label}>
                    {t("editor.programs.label")}
                  </DropdownMenu.Label>
                  <DropdownMenu.RadioGroup value={programs.activeId ?? ""} onValueChange={choose}>
                    {order.map((p) => {
                      const count = t("editor.programs.count", {
                        count: liveSessions(programs, p.id).length,
                      });
                      return (
                        <DropdownMenu.RadioItem key={p.id} value={p.id} className={item}>
                          <Row
                            icon={Dumbbell}
                            title={programName(p, t)}
                            sub={
                              p.id === programs.activeId
                                ? `${count} · ${t("editor.programs.active")}`
                                : count
                            }
                          />
                          <DropdownMenu.ItemIndicator>
                            <Check aria-hidden className="size-5 text-foreground" />
                          </DropdownMenu.ItemIndicator>
                        </DropdownMenu.RadioItem>
                      );
                    })}
                  </DropdownMenu.RadioGroup>
                  <DropdownMenu.Separator className={separator} />
                  <DropdownMenu.Item
                    className={item}
                    onSelect={(e) => {
                      // The second menu takes the first one's place, anchored the same.
                      e.preventDefault();
                      setMenu("new");
                    }}
                  >
                    <Row icon={Plus} title={t("editor.programs.new")} />
                  </DropdownMenu.Item>
                  {program && (
                    <DropdownMenu.Item
                      className={item}
                      onSelect={() => (after.current = { kind: "rename", program })}
                    >
                      <Row icon={Pencil} title={t("editor.programs.rename")} />
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Separator className={separator} />
                  {order.length > 1 && program ? (
                    <DropdownMenu.Item
                      className={`${item} text-destructive`}
                      onSelect={() => (after.current = { kind: "remove", program })}
                    >
                      <Trash2 aria-hidden className="size-5 shrink-0" />
                      <span className="flex-1 truncate font-semibold">
                        {t("editor.programs.remove")}
                      </span>
                    </DropdownMenu.Item>
                  ) : (
                    <DropdownMenu.Label className="px-3 py-3 text-body text-muted-foreground">
                      {t("editor.programs.lastOne")}
                    </DropdownMenu.Label>
                  )}
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      {removing && (
        <RemoveSheet
          program={removing}
          onConfirm={() => {
            const id = removing.id;
            void edits.record((p, at) => removeProgramFor(p, id, at));
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

// The name in place of the selector: Enter or a click away saves it trimmed, Escape leaves it as it
// was.
function NameField({
  initial,
  hintId,
  onSave,
  onCancel,
}: {
  initial: string;
  hintId: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  // Enter and Escape have answered: the blur that follows them saves nothing more.
  const answered = useRef(false);
  // The name as it was writes nothing.
  const save = () => (value.trim() === initial ? onCancel() : onSave(value.trim()));
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      answered.current = true;
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      answered.current = true;
      onCancel();
    }
  };
  return (
    <>
      <input
        ref={(el) => {
          if (!el || document.activeElement === el) return;
          el.focus();
          el.select();
        }}
        value={value}
        maxLength={PROGRAM_NAME_MAX}
        aria-label={t("editor.programs.nameLabel")}
        aria-describedby={hintId}
        autoComplete="off"
        onChange={(e) => {
          answered.current = false;
          setValue(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!answered.current) save();
        }}
        className="min-h-11 w-[300px] max-w-full rounded-control bg-surface px-3 text-body font-semibold text-foreground ring-[1.5px] ring-primary-ink outline-none ring-inset"
      />
      <p id={hintId} className="text-sm text-muted-foreground">
        {t("editor.programs.nameHint")}
      </p>
    </>
  );
}

// The question before a program goes: its name, its sessions, the one that becomes active.
function RemoveSheet({
  program,
  onConfirm,
  onClose,
}: {
  program: Program;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { programs } = useEditor();
  const count = liveSessions(programs, program.id).length;
  const neighbour = programs.programs.find((p) => p.id === neighbourOf(programs, program.id));
  const body =
    program.id === programs.activeId && neighbour
      ? t("editor.programs.removeBody", { count, previous: programName(neighbour, t) })
      : t("editor.programs.removeBodyInactive", { count });
  return (
    <ActionSheet
      title={t("editor.programs.removeTitle", { name: programName(program, t) })}
      body={body}
      confirm={t("editor.programs.removeConfirm")}
      cancel={t("editor.programs.cancel")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
