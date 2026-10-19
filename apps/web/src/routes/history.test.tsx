import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
      "Tue, Oct 6Session C · Glutes + light pull1 h 10",
      "Mon, Oct 5Session B · Legs58 min",
      "Fri, Oct 2Session A · Push1 h 04",
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

  it("says where the first session will be", async () => {
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    expect(await screen.findByText("Your first session will show here.")).toBeTruthy();
  });
});
