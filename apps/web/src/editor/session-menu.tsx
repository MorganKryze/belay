import { newId } from "@belay/shared";
import {
  copySession,
  cutName,
  removeSessionIn,
  setAside,
} from "@belay/shared/training/program-edits";
import { MAX_ROTATION, SESSION_NAME_MAX } from "@belay/shared/training/stored-program";
import { Link } from "@tanstack/react-router";
import { Archive, Copy, Ellipsis, Eye, type LucideIcon, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { LETTERS, type PlacedSession, titleOf, useEditor } from "./editor-context";
import { movesSentence, spokenName } from "./session-chips";

const item =
  "flex min-h-11 w-full cursor-default items-center gap-3 rounded-chip px-3 py-1.5 text-left text-body outline-hidden select-none data-highlighted:bg-(--press-tint)";

function Row({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub?: string }) {
  return (
    <>
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{title}</span>
        {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
      </span>
    </>
  );
}

// The shown session's ⋯: Renommer, Dupliquer la séance, Mettre de côté (or, set aside, Voir la
// séance), then its removal in red, apart. The last session of the rotation neither goes nor is
// set aside: a neutral line says why instead.
export function SessionMenu({ placed, onRename }: { placed: PlacedSession; onRename(): void }) {
  const { t } = useTranslation();
  const { rotation, aside, edits, show } = useEditor();
  // The name field takes the focus itself, so it opens once the menu has given the focus back.
  const renameAfter = useRef(false);
  const id = placed.session.id;
  const inRotation = placed.letter !== null;
  const list = inRotation ? rotation : aside;
  const ids = rotation.map((p) => p.session.id);
  const without = ids.filter((x) => x !== id);
  const name = spokenName(placed, t);
  const last = inRotation && rotation.length === 1;

  const duplicate = async () => {
    const copyName = cutName(t("editor.session.copyName", { name }), SESSION_NAME_MAX);
    // The copy's id is the first one the rule asks for.
    let created: string | null = null;
    const nextId = () => {
      const next = newId();
      created ??= next;
      return next;
    };
    const ok = await edits.record((p, at) => copySession(p, id, copyName, nextId, at), {
      toast: inRotation
        ? t("editor.toast.duplicated", { name, code: LETTERS[rotation.length] })
        : t("editor.toast.duplicatedAside", { name, copy: copyName }),
      refused: t(
        inRotation && rotation.length >= MAX_ROTATION
          ? "editor.limit.rotation"
          : "editor.limit.sessions",
      ),
    });
    if (ok && created) show(created);
  };
  const putAside = () =>
    void edits.record((p, at) => setAside(p, id, at), {
      toast: t("editor.toast.setAside", { name }) + movesSentence(ids, without, t),
    });
  const remove = async () => {
    const at = list.findIndex((p) => p.session.id === id);
    const neighbour = list[at + 1] ?? list[at - 1];
    const title = titleOf(placed, t);
    const ok = await edits.record((p, when) => removeSessionIn(p, id, when), {
      toast:
        t("editor.toast.sessionRemoved", { title }) +
        (inRotation ? movesSentence(ids, without, t) : ""),
    });
    if (ok) show(id, neighbour?.session.id);
  };

  return (
    // Not modal, as the row menu: a modal menu hides the page from assistive technology while its
    // controls stay focusable behind it. Focus still moves into the menu and Escape brings it back.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label={t("editor.card.more")}
        className="grid size-11 shrink-0 place-items-center rounded-control bg-track text-foreground outline-ring focus-visible:outline-2 -outline-offset-2 data-[state=open]:ring-[1.5px] data-[state=open]:ring-primary-ink data-[state=open]:ring-inset"
      >
        <Ellipsis aria-hidden className="size-5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={(e) => {
            if (!renameAfter.current) return;
            renameAfter.current = false;
            e.preventDefault();
            onRename();
          }}
          className="z-50 w-[340px] max-w-[calc(100vw-1rem)] rounded-field bg-popover p-1 text-popover-foreground shadow-float data-[state=open]:animate-fade-in dark:border dark:border-border"
        >
          <DropdownMenu.Item className={item} onSelect={() => (renameAfter.current = true)}>
            <Row icon={Pencil} title={t("editor.session.rename")} />
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => void duplicate()}>
            <Row icon={Copy} title={t("editor.session.duplicate")} />
          </DropdownMenu.Item>
          {inRotation ? (
            !last && (
              <DropdownMenu.Item className={item} onSelect={putAside}>
                <Row
                  icon={Archive}
                  title={t("editor.session.setAside")}
                  sub={t("editor.session.setAsideSub")}
                />
              </DropdownMenu.Item>
            )
          ) : (
            <DropdownMenu.Item className={item} asChild>
              <Link to="/workouts/session/$code" params={{ code: id }}>
                <Row icon={Eye} title={t("editor.session.see")} />
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />
          {last ? (
            <DropdownMenu.Label className="px-3 py-3 text-body text-muted-foreground">
              {t("editor.session.lastOne")}
            </DropdownMenu.Label>
          ) : (
            <DropdownMenu.Item
              className={`${item} text-destructive`}
              onSelect={() => void remove()}
            >
              <Trash2 aria-hidden className="size-5 shrink-0" />
              <span className="flex-1 font-semibold">
                {inRotation
                  ? t("editor.session.remove", { code: placed.letter })
                  : t("editor.session.removeAside")}
              </span>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
