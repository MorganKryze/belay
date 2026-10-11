import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

// Wednesday 7 October 2026, 18:00 on the phone's clock.
beforeEach(() => {
  indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 18, 0));
  writeLastUser(ADA);
  fakeApi({ me: ADA });
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${String(n).padStart(2, "0")}`;
// A finished session of `code` begun on day `d` of October at 18:00 (local time).
const done = (n: number, code: string, d: number): Change[] => {
  const start = new Date(2026, 9, d, 18, 0).toISOString();
  const end = new Date(2026, 9, d, 19, 0).toISOString();
  return [
    {
      kind: "workout",
      id: id(n),
      field: "start",
      sessionCode: code,
      plan: [...sessionByCode(code)!.slots],
      startedAt: start,
      at: start,
    },
    { kind: "workout", id: id(n), field: "ended", value: end, at: end },
  ];
};
const cards = async () =>
  (await screen.findAllByRole("region", { name: /^Session / })).map(
    (r) => r.querySelector("h2")!.textContent!,
  );

describe("the program as cards (spec D13, §4.5)", () => {
  it("puts the next session first, then when each other one was last done", async () => {
    await seed(ADA.id, [...done(1, "A", 3), ...done(2, "B", 4)]);
    renderRoute("/workouts?tab=program");
    expect(await cards()).toEqual([
      "Session C · Glutes + light pull",
      "Session A · Push",
      "Session B · Legs",
    ]);
    const c = screen.getByRole("region", { name: "Session C · Glutes + light pull" });
    // No climb this week: the rule's two slots count.
    expect(c.textContent).toContain("Next up · 10 exercises · ~60 min");
    expect(within(c).queryByRole("button", { name: "See" })).toBeNull();
    expect(within(c).getByRole("link", { name: "Start" }).getAttribute("href")).toBe(
      "/workout?start=C",
    );
    const a = screen.getByRole("region", { name: "Session A · Push" });
    expect(a.textContent).toContain("4 days ago · 6 exercises · ~55 min");
    expect(screen.getByRole("region", { name: "Session B · Legs" }).textContent).toContain(
      "3 days ago",
    );
    fireEvent.click(within(a).getByRole("button", { name: "See" }));
    expect(within(a).getAllByRole("link", { name: /Barbell bench press/ })).toHaveLength(1);
  });

  it("says never done, done today, and counts C without its rule once climbed", async () => {
    await seed(ADA.id, [
      ...done(1, "B", 7),
      {
        kind: "activity",
        id: id(90),
        field: "fields",
        date: "2026-10-05",
        type: "climbing",
        durationMin: 90,
        cardioType: null,
        climbStyle: null,
        climbRuns: null,
        climbGrade: null,
        climbColor: null,
        at: "2026-10-05T18:00:00.000Z",
      },
    ]);
    renderRoute("/workouts?tab=program");
    await cards();
    expect(
      screen.getByRole("region", { name: "Session C · Glutes + light pull" }).textContent,
    ).toContain("Next up · 8 exercises");
    expect(screen.getByRole("region", { name: "Session A · Push" }).textContent).toContain(
      "Never done",
    );
    expect(screen.getByRole("region", { name: "Session B · Legs" }).textContent).toContain(
      "Done today",
    );
  });

  it("starts the next session from its card", async () => {
    renderRoute("/workouts?tab=program");
    const a = await screen.findByRole("region", { name: "Session A · Push" });
    fireEvent.click(within(a).getByRole("link", { name: "Start" }));
    expect(await screen.findByRole("heading", { name: "Session A · Push", level: 1 })).toBeTruthy();
  });

  it("says it in French", async () => {
    await seed(ADA.id, done(1, "A", 3));
    await i18n.changeLanguage("fr");
    renderRoute("/workouts?tab=program");
    const b = await screen.findByRole("region", { name: "Séance B · Legs" });
    expect(b.textContent).toContain("La prochaine · 7 exercices · ~60 min");
    const a = screen.getByRole("region", { name: "Séance A · Push" });
    expect(a.textContent).toContain("Il y a 4 jours");
    expect(within(a).getByRole("button", { name: "Voir" })).toBeTruthy();
    expect(within(a).getByRole("link", { name: "Commencer" })).toBeTruthy();
  });
});
