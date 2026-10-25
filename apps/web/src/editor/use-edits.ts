// The editor's writes: each edit built by the shared rules on the programs shown, stored and
// queued at once, with a toast for what goes wrong and an undo for each one this visit made.
import { type ProgramEdit, undoOf } from "@belay/shared/training/program-undo";
import type { StoredPrograms } from "@belay/shared/training/stored-program";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToastState } from "@/components/weigh-in";
import { type OpenAccount, useRecord } from "@/sync/account";
import { readPrograms } from "@/sync/db";

export interface EditOptions {
  toast?: string; // shown with « Annuler » once written
  refused?: string; // shown when the rules refuse the edit, instead of the general refusal
}
export interface Edits {
  record(
    build: (p: StoredPrograms, at: string) => readonly ProgramEdit[] | null,
    options?: EditOptions,
  ): Promise<boolean>;
  undo(): Promise<boolean>; // the newest entry
  canUndo: boolean;
  toast: ToastState | null;
  dismiss(): void;
  saved: boolean; // something was written during this visit
}

// What an undo needs: the programs the edit was built on and the changes it wrote.
interface Entry {
  before: StoredPrograms;
  edit: readonly ProgramEdit[];
}
// ponytail: the 50 latest edits of a visit can be undone, the oldest dropped past that. Upgrade:
// keep the entries in sessionStorage if a visit ever needs more, or one that survives a reload.
const MAX_ENTRIES = 50;

export function useEdits(account: OpenAccount, programs: StoredPrograms): Edits {
  const { t } = useTranslation();
  const write = useRecord(account);
  const queryClient = useQueryClient();
  const entries = useRef<Entry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [saved, setSaved] = useState(false);
  const toastId = useRef(0);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const say = useCallback(
    (text: string, error = false) =>
      setToast({ id: ++toastId.current, text, ...(error && { error }) }),
    [],
  );
  const drop = useCallback((entry: Entry) => {
    entries.current = entries.current.filter((e) => e !== entry);
    setCanUndo(entries.current.length > 0);
  }, []);

  // False, with the reason on screen, when nothing was kept. A RangeError is a change the
  // device refuses: built on a view another device or tab has changed since, or outside the
  // contract; recordChanges throws it before or inside its transaction, so nothing is kept, and
  // the view is read again to show the current values.
  const store = useCallback(
    async (changes: readonly ProgramEdit[]) => {
      try {
        await write(changes);
        setSaved(true);
        return true;
      } catch (error) {
        if (error instanceof RangeError) {
          say(t("editor.toast.stale"), true);
          await queryClient.invalidateQueries({ queryKey: ["local", account.user.id] });
        } else say(t("editor.toast.failed"), true);
        return false;
      }
    },
    [account.user.id, queryClient, say, t, write],
  );

  // Undoes one entry against the programs stored now, never the view: a value another device
  // wrote since stays. An undo that could not be written stays on the stack, to try again.
  const undoEntry = useCallback(
    async (entry: Entry) => {
      const at = new Date().toISOString();
      const changes = undoOf(entry.before, entry.edit, await readPrograms(account.db), at);
      if (changes.length === 0) {
        drop(entry);
        say(t("editor.toast.nothingToUndo"));
        return false;
      }
      if (!(await store(changes))) return false;
      drop(entry);
      say(t("editor.toast.undone"));
      return true;
    },
    [account.db, drop, say, store, t],
  );

  const record = useCallback(
    async (
      build: (p: StoredPrograms, at: string) => readonly ProgramEdit[] | null,
      options: EditOptions = {},
    ) => {
      const changes = build(programs, new Date().toISOString());
      if (changes === null) {
        say(options.refused ?? t("editor.toast.refused"), true);
        return false;
      }
      if (changes.length === 0) return true;
      if (!(await store(changes))) return false;
      const entry: Entry = { before: programs, edit: changes };
      entries.current = [...entries.current, entry].slice(-MAX_ENTRIES);
      setCanUndo(true);
      if (options.toast)
        setToast({ id: ++toastId.current, text: options.toast, undo: () => undoEntry(entry) });
      return true;
    },
    [programs, say, store, t, undoEntry],
  );

  const undo = useCallback(async () => {
    const entry = entries.current.at(-1);
    return entry ? undoEntry(entry) : false;
  }, [undoEntry]);

  return { record, undo, canUndo, toast, dismiss: () => setToast(null), saved };
}
