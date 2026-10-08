import { addDays } from "@belay/shared/body/dates";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed, weight } from "../test/seed";

beforeEach(() => {
  indexedDB = new IDBFactory();
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("the Body tab", () => {
  it("sits second in the bar: Home, Body, Tools, Settings", async () => {
    fakeApi({ me: null });
    renderRoute("/body");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Home", "Body", "Tools", "Settings"]);
    expect(within(nav).getByRole("link", { name: "Body" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("explains, signed out, that tracking needs an account", async () => {
    fakeApi({ me: null });
    renderRoute("/body");
    expect(await screen.findByText(/Tracking your weigh-ins needs an account/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/auth/login?returnTo=%2Fbody",
    );
  });

  it("shows the sync banner to someone signed in", async () => {
    await seed(ADA.id, [weight("2026-10-07", 79.8)]);
    writeLastUser(ADA);
    fakeApi({ me: "down" });
    renderRoute("/body");
    expect(await screen.findByText(/1 weigh-in waiting/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Body", level: 1 })).toBeTruthy();
  });
});

// Wednesday 7 October 2026: the current ISO week runs from Monday 5 October.
const days = (first: string, kgs: number[]) => kgs.map((kg, i) => weight(addDays(first, i), kg));
const WEEKS = [
  ...days("2026-09-14", [81, 81, 81]), // 3 weigh-ins: insufficient
  ...days("2026-09-21", [80.8, 80.8, 80.8, 80.8]), // valid, the week before is insufficient
  ...days("2026-09-28", [80.2, 80.2, 80.2, 80.2]), // valid: 0.7 % against 80.8
  ...days("2026-10-05", [80, 79.9, 79.8]), // this week, in progress
];

describe("the Body page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 8, 0));
    writeLastUser(ADA);
  });
  afterEach(() => vi.useRealTimers());

  async function open(changes = WEEKS) {
    await seed(ADA.id, changes);
    fakeApi({ me: ADA });
    renderRoute("/body");
    return screen.findByRole("region", { name: "Your weeks" });
  }
  const rows = (list: HTMLElement) =>
    within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent);

  it("lists the weeks and says in words why one does not count", async () => {
    expect(rows(await open())).toEqual([
      "This weekin progress · 3 weigh-insongoing",
      "Sep 28 – Oct 4average 80.2 kg0.7%in your range",
      "Sep 21 – 27average 80.8 kg—week before insufficient",
      "Sep 14 – 203 weigh-ins, 4 minimuminsufficient",
    ]);
  });

  it("shows the latest 7-day average and the last complete week's loss in the range", async () => {
    await open();
    expect(screen.getByText("7-day average", { selector: "p" }).nextSibling?.textContent).toBe(
      "80.0kg",
    );
    expect(screen.getByText("Loss per week").parentElement?.textContent).toBe(
      "Loss per week0.7%in your range",
    );
  });

  it("shows a loss outside the range as a number alone, with no word that judges", async () => {
    await open([
      ...WEEKS,
      { kind: "target", minPct: 0.25, maxPct: 0.5, at: "2026-10-07T06:00:00.000Z" },
    ]);
    expect(screen.getByText("Loss per week").parentElement?.textContent).toBe("Loss per week0.7%");
    expect(screen.queryByText("in your range")).toBeNull();
  });

  it("says a gain as a gain, in neutral words", async () => {
    await i18n.changeLanguage("fr");
    await seed(ADA.id, [
      ...days("2026-09-21", [80.8, 80.8, 80.8, 80.8]),
      ...days("2026-09-28", [81, 81, 81, 81]),
    ]);
    fakeApi({ me: ADA });
    renderRoute("/body");
    const perte = await screen.findByText("Perte par semaine");
    expect(perte.parentElement?.textContent).toBe("Perte par semaine0,2% de prise");
    const weeks = await screen.findByRole("region", { name: "Tes semaines" });
    expect(within(weeks).getByText("0,2 % de prise")).toBeTruthy(); // the matcher folds the narrow space
  });

  it("explains the first days instead of an average", async () => {
    await seed(ADA.id, days("2026-10-06", [80.2, 80.1]));
    fakeApi({ me: ADA });
    renderRoute("/body");
    expect(await screen.findByRole("heading", { name: "2 more weigh-ins this week" })).toBeTruthy();
    expect(screen.getByText(/A single day's weight varies too much to say anything/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Your weeks" })).toBeNull();
    expect(screen.getByRole("button", { name: /Yesterday/ })).toBeTruthy();
  });

  it("opens a weigh-in from the history, and gives focus back to its line", async () => {
    await open();
    const history = screen.getByRole("region", { name: "History" });
    const row = within(history).getByRole("button", { name: /^Thu, Oct 1/ });
    expect(within(history).getAllByRole("button")[0]!.textContent).toBe("Today79.8 kg");
    row.focus();
    fireEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "Weigh-in" });
    expect(within(sheet).getByText("Thu, Oct 1")).toBeTruthy(); // the day, in the header
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(row);
  });

  it("reads the chart from the keyboard, and opens the day under the crosshair", async () => {
    await open();
    const chart = screen.getByRole("img", { name: /^Weigh-ins from Sep 8 to Oct 7\./ });
    fireEvent.focus(chart);
    await waitFor(() =>
      expect(chart.parentElement!.textContent).toContain(
        "Wed, Oct 7Weigh-in 79.8 kg7-day avg 80.0 kg",
      ),
    );
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(chart.parentElement!.textContent).toContain("Tue, Oct 6Weigh-in 79.9 kg");
    fireEvent.keyDown(chart, { key: "Enter" });
    const sheet = await screen.findByRole("dialog", { name: "Weigh-in" });
    expect(within(sheet).getByText("Yesterday")).toBeTruthy(); // Tuesday 6 October
  });

  it("widens to every weigh-in with All", async () => {
    await open([...WEEKS, weight("2026-07-01", 83)]);
    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).queryByText("Wed, Jul 1")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(await within(history).findByText("Wed, Jul 1")).toBeTruthy();
  });
});
