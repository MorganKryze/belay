import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editSlot, renameSession, replaceExercise } from "@belay/shared/training/program-edits";
import { seedId, type StoredPrograms } from "@belay/shared/training/stored-program";
import i18n from "@/i18n";
import type { OpenAccount } from "@/sync/account";
import { type AccountDb, openAccountDb, readOutbox, readPrograms, recordChanges } from "@/sync/db";
import type { SyncEngine } from "@/sync/engine";
import { useEdits } from "./use-edits";

const A = seedId(1); // the starting program's session A
const BENCH = seedId(0x101); // session A's first slot, counted in repetitions
const PLANK = { id: "ds:2135", measure: "seconds" } as const;
const USER = { id: "user-ada", displayName: "Ada" };

// A fixed clock moved on by hand: each write lands at a known time, never in the same millisecond
// as the one before it by chance.
const START = "2026-10-25T08:00:00.000Z";
const later = () => vi.setSystemTime(Date.now() + 1000);

let db: AccountDb;
let client: QueryClient;
let account: OpenAccount;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(START));
  indexedDB = new IDBFactory();
  db = await openAccountDb(USER.id);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const engine = { schedule: vi.fn() } as unknown as SyncEngine;
  account = { kind: "open", user: USER, db, engine };
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  db.close();
  vi.useRealTimers();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
// The hook as the editor mounts it, on the programs the device holds.
async function mount() {
  const hook = renderHook(({ programs }) => useEdits(account, programs), {
    wrapper,
    initialProps: { programs: await readPrograms(db) },
  });
  // The editor's view follows each write, as the query refresh redraws it.
  const refresh = async () => hook.rerender({ programs: await readPrograms(db) });
  return { ...hook, refresh };
}
const benchOf = async () => (await readPrograms(db)).slots.find((s) => s.id === BENCH)!;
const sessionA = async () => (await readPrograms(db)).sessions.find((s) => s.id === A)!;
const setsTo = (value: number) => (p: StoredPrograms, at: string) =>
  editSlot(p, BENCH, { field: "sets", value }, at);

describe("useEdits", () => {
  it("an edit is stored and queued", async () => {
    const { result } = await mount();
    let ok = false;
    await act(async () => {
      ok = await result.current.record(setsTo(5));
    });
    expect(ok).toBe(true);
    expect((await benchOf()).sets).toBe(5);
    const outbox = await readOutbox(db);
    expect(outbox.map((e) => e.change)).toEqual([
      expect.objectContaining({ kind: "programSlot", id: BENCH, field: "sets", value: 5 }),
    ]);
    expect(account.engine.schedule).toHaveBeenCalled();
    expect(result.current.canUndo).toBe(true);
    expect(result.current.toast).toBeNull();
  });

  it("a refused build writes nothing and shows the refusal", async () => {
    const { result } = await mount();
    let ok = true;
    await act(async () => {
      ok = await result.current.record(() => null);
    });
    expect(ok).toBe(false);
    expect(result.current.toast).toMatchObject({ text: "editor.toast.refused", error: true });
    await act(async () => {
      await result.current.record(() => null, { refused: "Thirty exercises at most" });
    });
    expect(result.current.toast).toMatchObject({
      text: "Thirty exercises at most",
      error: true,
    });
    // Nothing to change: done, with nothing written.
    await act(async () => {
      ok = await result.current.record(() => []);
    });
    expect(ok).toBe(true);
    expect(await readOutbox(db)).toEqual([]);
    expect(result.current.canUndo).toBe(false);
  });

  it("a stale change (RangeError) writes nothing, shows the stale toast and refreshes the view", async () => {
    const { result } = await mount();
    // Another tab swapped the slot to a timed exercise after this view was drawn, at an earlier
    // time than the edit below: only the measure refuses that edit, not its time.
    const view = await readPrograms(db);
    await recordChanges(db, replaceExercise(view, BENCH, PLANK, START)!);
    later();
    const refresh = vi.spyOn(client, "invalidateQueries");
    let ok = true;
    await act(async () => {
      ok = await result.current.record((p, at) =>
        editSlot(p, BENCH, { field: "reps", value: [10, 12] }, at),
      );
    });
    expect(ok).toBe(false);
    expect(result.current.toast).toMatchObject({ text: "editor.toast.stale", error: true });
    expect(refresh).toHaveBeenCalledWith({ queryKey: ["local", USER.id] });
    expect(await readOutbox(db)).toHaveLength(1);
    expect((await benchOf()).measure).toBe("seconds");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.saved).toBe(false);
  });

  it("any other failure writes nothing and says it could not save", async () => {
    const { result } = await mount();
    db.close(); // a lost connection: every call on it throws
    let ok = true;
    await act(async () => {
      ok = await result.current.record(setsTo(5));
    });
    expect(ok).toBe(false);
    expect(result.current.toast).toMatchObject({ text: "editor.toast.failed", error: true });
    db = await openAccountDb(USER.id);
    expect(await readOutbox(db)).toEqual([]);
  });

  it("undo restores the previous value", async () => {
    const { result, refresh } = await mount();
    const sets = (await benchOf()).sets;
    await act(async () => {
      await result.current.record(setsTo(5), { toast: "Saved" });
    });
    expect(result.current.toast).toMatchObject({ text: "Saved" });
    expect(result.current.toast?.undo).toBeTypeOf("function");
    await act(refresh);
    later();
    let ok = false;
    await act(async () => {
      ok = await result.current.undo();
    });
    expect(ok).toBe(true);
    expect((await benchOf()).sets).toBe(sets);
    expect(result.current.toast).toMatchObject({ text: "editor.toast.undone" });
    expect(result.current.canUndo).toBe(false);
    expect(await readOutbox(db)).toHaveLength(2);
    // Nothing left: no write.
    await act(async () => {
      ok = await result.current.undo();
    });
    expect(ok).toBe(false);
    expect(await readOutbox(db)).toHaveLength(2);
  });

  it("an undo over a value another device changed since writes nothing and says so", async () => {
    const { result, refresh } = await mount();
    await act(async () => {
      await result.current.record(setsTo(5));
    });
    await act(refresh);
    later();
    await recordChanges(db, setsTo(6)(await readPrograms(db), new Date().toISOString())!);
    later();
    let ok = true;
    await act(async () => {
      ok = await result.current.undo();
    });
    expect(ok).toBe(false);
    expect(result.current.toast).toMatchObject({ text: "editor.toast.nothingToUndo" });
    expect((await benchOf()).sets).toBe(6);
    expect(await readOutbox(db)).toHaveLength(2);
  });

  it("a toast's Annuler undoes its own entry after a newer edit", async () => {
    const { result, refresh } = await mount();
    const before = await benchOf();
    await act(async () => {
      await result.current.record(setsTo(5), { toast: "Sets saved" });
    });
    const first = result.current.toast!;
    await act(refresh);
    later();
    await act(async () => {
      await result.current.record(
        (p, at) => editSlot(p, BENCH, { field: "rest", value: 240 }, at),
        {
          toast: "Rest saved",
        },
      );
    });
    await act(refresh);
    later();
    await act(async () => {
      expect(await first.undo!()).toBe(true);
    });
    expect(await benchOf()).toMatchObject({ sets: before.sets, restSec: 240 });
    // The newer entry is still there, and only it.
    expect(result.current.canUndo).toBe(true);
    await act(refresh);
    later();
    await act(async () => {
      await result.current.undo();
    });
    expect(await benchOf()).toMatchObject({ sets: before.sets, restSec: before.restSec });
    expect(result.current.canUndo).toBe(false);
  });

  it("the 51st entry drops the oldest", async () => {
    const { result, refresh } = await mount();
    for (let i = 0; i < 51; i++) {
      await act(async () => {
        await result.current.record((_, at) => renameSession(A, `Name ${i}`, at));
      });
      await act(refresh);
      later();
    }
    let undone = 0;
    while (result.current.canUndo) {
      await act(async () => {
        if (await result.current.undo()) undone++;
      });
      await act(refresh);
      later();
    }
    expect(undone).toBe(50);
    // The oldest edit was dropped: its name stays.
    expect((await sessionA()).name).toBe("Name 0");
  });

  it("saved turns true after a write", async () => {
    const { result } = await mount();
    expect(result.current.saved).toBe(false);
    await act(async () => {
      await result.current.record(() => null);
    });
    expect(result.current.saved).toBe(false);
    await act(async () => {
      await result.current.record(setsTo(5));
    });
    expect(result.current.saved).toBe(true);
  });
});
