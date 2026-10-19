import type { Change } from "@belay/shared/sync/schema";
import {
  act,
  cleanup,
  fireEvent,
  getDefaultNormalizer,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";
import { MONTH, marked, session } from "../test/workout-fixtures";

// Wednesday 7 October 2026, 7:30 in the morning, on the phone's clock.
beforeEach(() => {
  indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 7, 30));
  writeLastUser(ADA);
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("the History segment", () => {
  it("asks to sign in when there is no account", async () => {
    fakeApi({ me: null });
    localStorage.clear();
    renderRoute("/workouts?tab=history");
    expect(await screen.findByText(/Your sessions are kept with an account/)).toBeTruthy();
  });

  it("marks the days with a finished session, and lists the month newest first", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    const calendar = await screen.findByRole("table", { name: "October 2026" });
    await waitFor(() => expect(marked(calendar)).toEqual(["2", "5", "6"]));
    const list = screen.getByRole("region", { name: "Recent" });
    expect(
      within(list)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual([
      "Tue, Oct 6 · 1 h 10 Session C · Glutes + light pull",
      "Mon, Oct 5 · 58 min Session B · Legs",
      "Fri, Oct 2 · 1 h 04 Session A · Push",
    ]);
  });

  it("recent sessions tint on press", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    const list = await screen.findByRole("region", { name: "Recent" });
    await waitFor(() => expect(within(list).getAllByRole("link")).toHaveLength(3));
    for (const row of within(list).getAllByRole("link")) {
      expect(row.className).toContain("press-tint");
    }
  });

  it("goes back a month, never past the current one", async () => {
    await seed(ADA.id, [...MONTH, ...session(6, "C", new Date(2026, 8, 28, 18, 0), 45)]);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    await screen.findByRole("table", { name: "October 2026" });
    expect((screen.getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    const calendar = await screen.findByRole("table", { name: "September 2026" });
    expect(marked(calendar)).toEqual(["28"]);
    const list = screen.getByRole("region", { name: "September 2026" });
    expect(within(list).getByRole("link").textContent).toContain("45 min");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await screen.findByText("No session this month.")).toBeTruthy();
  });

  it("the log row sits under the calendar and opens the log sheet", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    const calendar = await screen.findByRole("table", { name: "October 2026" });
    const rows = screen.getAllByRole("button", { name: /^Log a session/ });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.textContent).toContain("done without the app, on another day");
    expect(calendar.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing between the page's segments and the calendar: the log row left the top.
    const card = calendar.parentElement!;
    const above = screen
      .getAllByRole("button")
      .filter(
        (b) =>
          !card.contains(b) && card.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING,
      );
    expect(above.map((b) => b.textContent)).not.toContainEqual(expect.stringMatching(/Log/));
    await act(async () => fireEvent.click(row));
    expect(await screen.findByRole("dialog", { name: "Log a session" })).toBeTruthy();
  });

  it("lists the month as one grouped list: day and length, then the title in full", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    const list = await screen.findByRole("region", { name: "Recent" });
    await waitFor(() => expect(within(list).getAllByRole("link")).toHaveLength(3));
    expect(within(list).getByRole("heading", { level: 2, name: "Recent" })).toBeTruthy();
    expect(within(list).getAllByRole("list")).toHaveLength(1);
    const first = within(list).getAllByRole("link")[0]!;
    expect(first.textContent).toBe("Tue, Oct 6 · 1 h 10 Session C · Glutes + light pull");
    expect(within(first).getByText("Session C · Glutes + light pull")).toBeTruthy();
  });

  it("an activity row says its day, then its summary", async () => {
    const climb: Change = {
      kind: "activity",
      id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7da1",
      field: "fields",
      date: "2026-10-04",
      type: "climbing",
      durationMin: 90,
      cardioType: null,
      climbStyle: "boulder",
      climbRuns: 14,
      climbGrade: "6b+",
      climbColor: null,
      at: "2026-10-04T16:00:00.000Z",
    };
    await seed(ADA.id, [...MONTH, climb]);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    const list = await screen.findByRole("region", { name: "Recent" });
    const row = await within(list).findByRole("button", { name: /^Sun, Oct 4/ });
    expect(row.textContent).toBe("Sun, Oct 4 Climbing · 1 h 30 · 6b+");
    // Between the 5th and the 2nd, in the one list.
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent!.slice(0, 10)),
    ).toEqual(["Tue, Oct 6", "Mon, Oct 5", "Sun, Oct 4", "Fri, Oct 2"]);
    await act(async () => fireEvent.click(row));
    expect(await screen.findByRole("dialog", { name: "Activity" })).toBeTruthy();
  });

  it("an empty history explains, inside the card, how a session gets there", async () => {
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    const sentence = await screen.findByText("Your first session will show here.");
    const card = sentence.closest(".rounded-group")!;
    expect(card).toBeTruthy();
    expect(screen.getByRole("region", { name: "Recent" }).contains(card)).toBe(true);
    expect(card.textContent).toContain(
      "It shows up on its own when you finish a session, or with “Log a session”.",
    );
    expect(within(card as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(card as HTMLElement).queryByRole("link")).toBeNull();
  });

  it("a month with nothing says so in the card", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    await screen.findByRole("table", { name: "October 2026" });
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    const line = await screen.findByText("No session this month.");
    const card = line.closest(".rounded-group")!;
    expect(card).toBeTruthy();
    expect(screen.getByRole("region", { name: "September 2026" }).contains(card)).toBe(true);
    expect(within(card as HTMLElement).queryByRole("button")).toBeNull();
  });

  describe("with Sessions only", () => {
    const climb = (date: string): Change => ({
      kind: "activity",
      id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7da2",
      field: "fields",
      date,
      type: "climbing",
      durationMin: 90,
      cardioType: null,
      climbStyle: "boulder",
      climbRuns: 14,
      climbGrade: "6b+",
      climbColor: null,
      at: `${date}T16:00:00.000Z`,
    });
    beforeEach(() => localStorage.setItem("belay.historyActivities", "hidden"));

    it("leaves activities out: no dot, a two-item legend, no activity row", async () => {
      await seed(ADA.id, [...MONTH, climb("2026-10-04")]);
      fakeApi({ me: ADA });
      renderRoute("/workouts?tab=history");
      const list = await screen.findByRole("region", { name: "Recent" });
      await waitFor(() => expect(within(list).getAllByRole("link")).toHaveLength(3));
      expect(document.querySelector("[data-dot]")).toBeNull();
      const legend = screen.getByRole("list", { name: "Legend" });
      expect(
        within(legend)
          .getAllByRole("listitem")
          .map((li) => li.textContent),
      ).toEqual(["session", "today"]);
      expect(within(list).queryByRole("button")).toBeNull();
    });

    it("a month with only an activity says there is no session", async () => {
      await seed(ADA.id, [...MONTH, climb("2026-09-12")]);
      fakeApi({ me: ADA });
      renderRoute("/workouts?tab=history");
      await screen.findByRole("table", { name: "October 2026" });
      fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
      expect(await screen.findByText("No session this month.")).toBeTruthy();
    });

    it("the choice applies on the next mount", async () => {
      await seed(ADA.id, [...MONTH, climb("2026-10-04")]);
      fakeApi({ me: ADA });
      renderRoute("/workouts?tab=history");
      const list = await screen.findByRole("region", { name: "Recent" });
      await waitFor(() => expect(within(list).getAllByRole("link")).toHaveLength(3));
      localStorage.setItem("belay.historyActivities", "shown");
      expect(within(list).queryByRole("button")).toBeNull();
      cleanup();
      renderRoute("/workouts?tab=history");
      const again = await screen.findByRole("region", { name: "Recent" });
      expect(await within(again).findByRole("button", { name: /^Sun, Oct 4/ })).toBeTruthy();
    });
  });

  it("says it in French", async () => {
    await seed(ADA.id, MONTH);
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    const list = await screen.findByRole("region", { name: "Récentes" });
    await waitFor(() => expect(within(list).getAllByRole("link")).toHaveLength(3));
    expect(within(list).getAllByRole("link")[2]!.textContent).toBe(
      "Ven. 2 oct. · 1 h 04 Séance A · Push",
    );
    const row = screen.getByRole("button", { name: /^Saisir une séance/ });
    expect(row.textContent).toBe("Saisir une séance faite sans l'app, un autre jour");
  });

  it("says in French how the first session gets there", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    expect(await screen.findByText("Ta première séance apparaîtra ici.")).toBeTruthy();
    expect(
      screen.getByText(
        "Elle s'ajoute toute seule quand tu termines une séance, ou avec «\u202fSaisir une séance\u202f».",
        // Kept as written: the default normalizer would turn the narrow spaces into plain ones.
        { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) },
      ),
    ).toBeTruthy();
  });
});
