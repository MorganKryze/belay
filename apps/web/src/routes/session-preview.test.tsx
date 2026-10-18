import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readHistory } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

// The real clock: the dates below are set from it, so nothing here waits on a frozen time.
beforeEach(() => {
  indexedDB = new IDBFactory();
  writeLastUser(ADA);
  fakeApi({ me: ADA });
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${String(n).padStart(2, "0")}`;
const daysAgo = (days: number, hours = 18, minutes = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
};
// Session A three days ago, 52 minutes long: the bench press at 80 kg × 7, 6, then 77.5 kg × 8.
const START = daysAgo(3);
const END = daysAgo(3, 18, 52);
const LAST_A: Change[] = [
  {
    kind: "workout",
    id: id(1),
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A")!.slots],
    startedAt: START,
    at: START,
  },
  ...(
    [
      [80, 7],
      [80, 6],
      [77.5, 8],
    ] as const
  ).map(([weightKg, reps], k): Change => ({
    kind: "set",
    id: id(10 + k),
    workoutId: id(1),
    field: "create",
    slotIndex: 0,
    position: 3 + k,
    exerciseId: "ds:0025",
    warmup: false,
    weightKg,
    reps,
    rir: 1,
    doneAt: START,
    at: START,
  })),
  { kind: "workout", id: id(1), field: "ended", value: END, at: END },
];
// Session A started ten minutes ago, still open.
const TEN_AGO = new Date(Date.now() - 10 * 60_000).toISOString();
const OPEN_A: Change[] = [
  {
    kind: "workout",
    id: id(2),
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A")!.slots],
    startedAt: TEN_AGO,
    at: TEN_AGO,
  },
];

const exercises = (name = "Exercises") => screen.findByRole("region", { name });
const rows = (region: HTMLElement) => within(region).getAllByRole("link");
// The page's own back chevron, not the tab of the same name in the bar.
const back = (name: string) =>
  waitFor(() => {
    const link = screen.getAllByRole("link", { name }).find((a) => a.closest("nav") === null);
    expect(link).toBeTruthy();
    return link!;
  });
const WEEKDAY = "(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)";

describe("the session preview", () => {
  it("shows the session as it would start today", async () => {
    await seed(ADA.id, LAST_A);
    await i18n.changeLanguage("fr");
    renderRoute("/workouts/session/A?from=home");
    expect(await screen.findByRole("heading", { level: 1, name: "Séance A · Push" })).toBeTruthy();
    expect(await screen.findByText("6 exercices · 19 séries · environ 55 min")).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`^La dernière fois\\s: ${WEEKDAY} \\d+(er)? \\S+, 52 min$`)),
    ).toBeTruthy();
    const list = await exercises("Exercices");
    const links = rows(list);
    expect(links).toHaveLength(6);
    expect(links[0]!.textContent).toContain("Barbell bench press");
    expect(links[0]!.textContent).toContain("4 × 6–8 · RIR 1–2 · 80 kg × 7");
    expect(links[1]!.textContent).toContain("Dumbbell seated shoulder press");
    expect(links[1]!.textContent).not.toContain("kg ×");
    expect(within(list).getByText("1")).toBeTruthy();
    expect(within(list).getByText("séries · la dernière fois")).toBeTruthy();
    expect(
      screen.getByText(
        "Le programme se modifie sur ordinateur. En séance, tu peux remplacer un exercice ou ajouter une série.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Modifier")).toBeNull();
    const start = screen.getByRole("link", { name: "Commencer la séance" });
    expect(start.getAttribute("href")).toBe("/workout?start=A");
  });

  it("never done: no last-time line and no top set", async () => {
    renderRoute("/workouts/session/B");
    const list = await exercises();
    expect(rows(list)).toHaveLength(7);
    expect(screen.getByText("7 exercises · 21 sets · about 60 min")).toBeTruthy();
    expect(screen.queryByText(/^Last time/)).toBeNull();
    expect(list.textContent).not.toContain("kg ×");
  });

  it("session C in a week with no climbing lists the added slots", async () => {
    renderRoute("/workouts/session/C");
    const list = await exercises();
    const names = rows(list).map((a) => a.textContent);
    expect(names).toHaveLength(10);
    expect(names[8]).toContain("Cable lat pulldown");
    expect(names[9]).toContain("Dumbbell biceps curl");
    expect(screen.getByText("10 exercises · 26 sets · about 60 min")).toBeTruthy();
  });

  it("with A open, its preview resumes it", async () => {
    await seed(ADA.id, OPEN_A);
    renderRoute("/workouts/session/A");
    const resume = await screen.findByRole("link", { name: "Resume the session" });
    expect(resume.getAttribute("href")).toBe("/workout?start=A");
    expect(screen.queryByRole("link", { name: "Start the session" })).toBeNull();
  });

  it("with A open, B's preview says A is in progress and offers to resume it, and starts nothing", async () => {
    await seed(ADA.id, OPEN_A);
    renderRoute("/workouts/session/B");
    expect(await screen.findByText("Session A · Push is in progress.")).toBeTruthy();
    const resume = screen.getByRole("link", { name: "Resume the session in progress" });
    expect(resume.getAttribute("href")).toBe("/workout?start=A");
    expect(screen.queryByRole("link", { name: "Start the session" })).toBeNull();
    const db = await openAccountDb(ADA.id);
    expect((await readHistory(db)).workouts.map((w) => w.sessionCode)).toEqual(["A"]);
    db.close();
  });

  it("from Accueil the back chevron says Accueil, otherwise Programme", async () => {
    await i18n.changeLanguage("fr");
    renderRoute("/workouts/session/A?from=home");
    expect((await back("Accueil")).getAttribute("href")).toBe("/");
    cleanup();
    renderRoute("/workouts/session/A");
    expect((await back("Programme")).getAttribute("href")).toBe("/workouts?tab=program");
  });

  it("an unknown code is not found", async () => {
    renderRoute("/workouts/session/Z");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
  });

  it("an exercise row carries session and from", async () => {
    renderRoute("/workouts/session/A?from=home");
    const [bench] = rows(await exercises());
    expect(bench!.getAttribute("href")).toBe("/exercises/ds%3A0025?session=A&from=home");
    cleanup();
    renderRoute("/workouts/session/A");
    const [plain] = rows(await exercises());
    expect(plain!.getAttribute("href")).toBe("/exercises/ds%3A0025?session=A");
  });

  it("the exercise opened from it leads back to it, labelled with the session", async () => {
    renderRoute("/exercises/ds:0025?session=A&from=home");
    const back = await screen.findByRole("link", { name: "Session A" });
    expect(back.getAttribute("href")).toBe("/workouts/session/A?from=home");
    cleanup();
    renderRoute("/exercises/ds:0025?session=A");
    expect((await screen.findByRole("link", { name: "Session A" })).getAttribute("href")).toBe(
      "/workouts/session/A",
    );
  });
});
