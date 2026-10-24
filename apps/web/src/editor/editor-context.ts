import {
  byPosition,
  type Program,
  type ProgramSession,
  type ProgramSlot,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import type { TFunction } from "i18next";
import { createContext, useContext } from "react";
import { rotationTitle, sessionName } from "@/lib/format";
import type { OpenAccount } from "@/sync/account";

// A session as the editor shows it: its live slots by position, the normal ones and those of the
// weeks with no climbing apart. The letter is its place among the program's live sessions, empty
// ones included, so a session just added has one at once; a set-aside session has none.
export interface PlacedSession {
  session: ProgramSession;
  letter: string | null;
  slots: readonly ProgramSlot[];
  noClimbing: readonly ProgramSlot[];
}

export interface EditorState {
  account: OpenAccount;
  programs: StoredPrograms;
  program: Program | null;
  rotation: readonly PlacedSession[];
  aside: readonly PlacedSession[];
  shown: PlacedSession | null;
  show(sessionId: string): void;
  announce(text: string): void;
  search: { for: string | null; request(sessionId: string): void; done(): void };
}

export const EditorContext = createContext<EditorState | null>(null);

export function useEditor(): EditorState {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error("useEditor outside the program editor");
  return editor;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// The active program's live sessions lettered by place, A first, and the collection in its order.
// No active program, or a removed one, has no rotation; the collection is every program's.
export function placedOf(p: StoredPrograms): { rotation: PlacedSession[]; aside: PlacedSession[] } {
  const active = p.programs.find((x) => x.id === p.activeId && !x.removed);
  const live = p.slots.filter((s) => !s.removed).sort(byPosition);
  const place = (session: ProgramSession, letter: string | null): PlacedSession => {
    const own = live.filter((s) => s.sessionId === session.id);
    return {
      session,
      letter,
      slots: own.filter((s) => s.rule === null),
      noClimbing: own.filter((s) => s.rule === "no_climbing"),
    };
  };
  const sessionsOf = (programId: string | null) =>
    p.sessions.filter((s) => s.programId === programId && !s.removed).sort(byPosition);
  return {
    rotation: active ? sessionsOf(active.id).map((s, i) => place(s, LETTERS[i] ?? null)) : [],
    aside: sessionsOf(null).map((s) => place(s, null)),
  };
}

// « Séance D · Bras », « Séance D » without a name; a set-aside session by its name.
export const titleOf = ({ session, letter }: PlacedSession, t: TFunction): string =>
  letter === null
    ? sessionName(session, t)
    : rotationTitle({ code: letter, sessionId: session.id, name: session.name }, t);
