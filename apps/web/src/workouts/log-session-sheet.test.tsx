import type { ISODate } from "@belay/shared/body/dates";
import { setSchedule } from "@belay/shared/training/program-edits";
import { SEED_PROGRAM_ID, seedId } from "@belay/shared/training/stored-program";
import type { Workout } from "@belay/shared/training/workout";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import "../i18n/lazy";
import { AccountProvider } from "../sync/account";
import { openAccountDb } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { ADA, seed } from "../test/seed";
import { LogSessionSheet } from "./log-session-sheet";

const [PUSH, LEGS, GLUTES] = [seedId(1), seedId(2), seedId(3)];

// A finished session begun at 18:00 on the given day of October 2026, where the phone is.
const done = (n: number, code: string, day: number, sessionId: string): Workout => ({
  id: `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${String(n).padStart(2, "0")}`,
  sessionCode: code,
  sessionId,
  plan: [],
  startedAt: new Date(2026, 9, day, 18, 0).toISOString(),
  endedAt: new Date(2026, 9, day, 19, 0).toISOString(),
  note: null,
  exerciseNotes: {},
  removed: false,
});
// Glutes, session C, done on Monday 19 October: the rotation offers A next.
const HISTORY = [done(1, "B", 16, LEGS), done(2, "C", 19, GLUTES)];

// The sheet as the history tab opens it, on the account's stored programs.
function open(today: ISODate, workouts: readonly Workout[] = HISTORY) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AccountProvider>
        <LogSessionSheet
          today={today}
          workouts={workouts}
          activities={[]}
          onClose={() => {}}
          onOpen={() => {}}
        />
      </AccountProvider>
    </QueryClientProvider>,
  );
}
const chosen = async () => (await screen.findByRole("radio", { checked: true })).textContent;

// A device that has synced before, so the sheet reads what it holds without waiting on a first
// sync.
beforeEach(async () => {
  indexedDB = new IDBFactory();
  const db = await openAccountDb(ADA.id);
  await db.put("meta", "1", "cursor");
  db.close();
  writeLastUser(ADA);
  fakeApi({ me: ADA });
  await i18n.changeLanguage("fr");
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

describe("the log sheet's first choice", () => {
  it("in rotation the first choice is the session after the last one done", async () => {
    open("2026-10-21");
    expect(await chosen()).toBe("A");
  });

  it("on fixed days the first choice is today's planned session", async () => {
    // Push on Mondays, Legs on Wednesdays, Glutes on Saturdays; Wednesday 21 holds Legs.
    const days = [PUSH, null, LEGS, null, null, GLUTES, null];
    await seed(
      ADA.id,
      setSchedule(SEED_PROGRAM_ID, { mode: "fixed", days }, "2026-10-01T06:00:00.000Z"),
    );
    open("2026-10-21");
    expect(await chosen()).toBe("B");
  });

  it("on a rest day the first choice is the next session day's", async () => {
    const days = [PUSH, null, LEGS, null, null, GLUTES, null];
    await seed(
      ADA.id,
      setSchedule(SEED_PROGRAM_ID, { mode: "fixed", days }, "2026-10-01T06:00:00.000Z"),
    );
    // Thursday 22 rests; Saturday 24 holds Glutes.
    open("2026-10-22");
    expect(await chosen()).toBe("C");
  });
});
