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
  it("sits third in the bar: Home, Sessions, Body, Tools", async () => {
    fakeApi({ me: null });
    renderRoute("/body");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Home", "Sessions", "Body", "Tools"]);
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

const AT = "2026-10-01T06:30:00.000Z";
const CREATINE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8f";
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
      "This weekongoing3 weigh-ins",
      "Sep 28 – Oct 40.7% in your range80.2\u00a0kg",
      "Sep 21 – 27—week before insufficient ·80.8\u00a0kg",
      "Sep 14 – 20—3 weigh-ins, 4 minimum",
    ]);
  });

  // The first line of a week: its title, then its value at the right.
  const value = (row: HTMLElement) => row.children[1]!;

  it("a flat week reads stable, with no pill", async () => {
    const list = await open([
      ...days("2026-09-21", [80.8, 80.8, 80.8, 80.8]),
      ...days("2026-09-28", [80.8, 80.8, 80.8, 80.8]),
    ]);
    const flat = within(list).getAllByRole("listitem")[1]!;
    expect(flat.textContent).toBe("Sep 28 – Oct 4stable80.8\u00a0kg");
    expect(value(flat).textContent).toBe("stable");
    expect(within(list).queryByText("in your range")).toBeNull();
  });

  it("the pill says in your range once in the header and in words inside the pill", async () => {
    const list = await open();
    const said = within(list).getAllByText("in your range");
    expect(said).toHaveLength(2);
    const [legend, inPill] = said as [HTMLElement, HTMLElement];
    expect(legend.closest("li")).toBeNull(); // the header, beside « Your weeks »
    const header = legend.closest("div")!;
    expect(header.contains(screen.getByRole("heading", { name: "Your weeks" }))).toBe(true);
    const row = within(list).getAllByRole("listitem")[1]!;
    expect(value(row).contains(inPill)).toBe(true);
    expect(inPill.className).toContain("sr-only");
    expect(value(row).querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("a loss outside the range is the number alone", async () => {
    const list = await open([
      ...WEEKS,
      { kind: "target", minPct: 0.25, maxPct: 0.5, at: "2026-10-07T06:00:00.000Z" },
    ]);
    const row = within(list).getAllByRole("listitem")[1]!;
    expect(value(row).textContent).toBe("0.7%");
    expect(value(row).querySelector("svg")).toBeNull();
    expect(within(list).queryByText("in your range")).toBeNull();
  });

  it("with the range pill hidden on this device, Corps shows no pill: the figure card, the weeks and the header", async () => {
    localStorage.setItem("belay.rangePill", "hidden");
    const list = await open();
    const row = within(list).getAllByRole("listitem")[1]!;
    expect(value(row).textContent).toBe("0.7%");
    expect(value(row).querySelector("svg")).toBeNull();
    expect(within(list).queryByText("in your range")).toBeNull();
    expect(figureCard().textContent).toBe("7-day average80.0kgloss 0.7%/wk last week");
    expect(screen.queryByText("in your range")).toBeNull();
  });

  const intake = (date: string, kcal: number) =>
    ({ kind: "intake", date, field: "kcal", value: kcal, at: "2026-10-07T06:00:00.000Z" }) as const;
  const history = () =>
    within(screen.getByRole("region", { name: "History" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent!.replace(/\s/g, " "));

  it("with the weekly intake hidden, the weeks leave out kcal and the history keeps it", async () => {
    localStorage.setItem("belay.weekIntake", "hidden");
    const list = await open([...WEEKS, intake("2026-10-01", 2100)]);
    expect(within(list).getAllByRole("listitem")[1]!.textContent).toBe(
      "Sep 28 – Oct 40.7% in your range80.2\u00a0kg",
    );
    expect(list.textContent).not.toContain("kcal");
    expect(history()).toContain("Thu, Oct 180.2 kg2,100 kcal");
  });

  it("the choices apply when Corps mounts again", async () => {
    const list = await open([...WEEKS, intake("2026-10-01", 2100)]);
    expect(list.textContent).toContain("kcal");
    expect(within(list).getAllByText("in your range")).toHaveLength(2);
    cleanup();
    localStorage.setItem("belay.rangePill", "hidden");
    localStorage.setItem("belay.weekIntake", "hidden");
    renderRoute("/body");
    const again = await screen.findByRole("region", { name: "Your weeks" });
    expect(again.textContent).not.toContain("kcal");
    expect(screen.queryByText("in your range")).toBeNull();
  });

  it("the chart's summary says stable for a flat week", async () => {
    await open([
      ...days("2026-09-21", [80.8, 80.8, 80.8, 80.8]),
      ...days("2026-09-28", [80.8, 80.8, 80.8, 80.8]),
    ]);
    expect(
      screen.getByRole("img", { name: /^Weigh-ins from/ }).getAttribute("aria-label"),
    ).toContain("Loss per week: stable.");
  });

  const figureCard = () => screen.getByRole("region", { name: "7-day average" });

  it("opens on the figure card: the 7-day average, last week's loss and the pill", async () => {
    await open();
    const card = figureCard();
    expect(card.textContent).toBe("7-day average80.0kgloss 0.7%/wk last weekin your range");
    expect(within(card).queryByRole("link")).toBeNull();
  });

  it("a loss outside the range stands alone in the card", async () => {
    await open([
      ...WEEKS,
      { kind: "target", minPct: 0.25, maxPct: 0.5, at: "2026-10-07T06:00:00.000Z" },
    ]);
    expect(figureCard().textContent).toBe("7-day average80.0kgloss 0.7%/wk last week");
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
    const weeks = await screen.findByRole("region", { name: "Tes semaines" });
    const card = screen.getByRole("region", { name: "Moyenne 7 jours" });
    expect(within(card).getByText(/^prise/).textContent).toBe(
      "prise 0,2\u202f%/sem la semaine dernière",
    );
    const gain = within(weeks).getAllByRole("listitem")[1]!;
    expect(gain.children[1]!.textContent).toBe("0,2\u202f% de prise");
    expect(gain.querySelector("svg")).toBeNull(); // no pill on a gain
  });

  it("a flat week reads stable last week", async () => {
    await open([
      ...days("2026-09-21", [80.8, 80.8, 80.8, 80.8]),
      ...days("2026-09-28", [80.8, 80.8, 80.8, 80.8]),
    ]);
    const card = figureCard();
    expect(within(card).getByText("stable", { selector: "b" })).toBeTruthy();
    expect(card.textContent).toContain("stable last week");
    expect(card.textContent).not.toMatch(/loss|gain|0\.0/);
  });

  it("explains the first days inside the figure card", async () => {
    await seed(ADA.id, days("2026-10-06", [80.2, 80.1]));
    fakeApi({ me: ADA });
    renderRoute("/body");
    const heading = await screen.findByRole("heading", { name: "2 more weigh-ins this week" });
    const card = figureCard();
    expect(card.contains(heading)).toBe(true);
    expect(heading.tagName).toBe("H3");
    expect(within(card).getByText("—")).toBeTruthy();
    expect(
      within(card).getByText(/A single day's weight varies too much to say anything/),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Your weeks" })).toBeNull();
    expect(screen.getByRole("button", { name: /Yesterday/ })).toBeTruthy();
  });

  it("the creatine sentence sits in the figure card", async () => {
    await open([
      ...WEEKS,
      { kind: "supplement", id: CREATINE, field: "name", value: "Créatine", at: AT },
      { kind: "supplementLog", supplementId: CREATINE, date: "2026-10-01", taken: true, at: AT },
    ]);
    const note = screen.getByText(/rises by 1 to 2 kg of water/);
    expect(figureCard().lastElementChild).toBe(note);
  });

  it("the period sits between the figure card and the chart", async () => {
    await open();
    const card = figureCard();
    const period = screen.getByRole("radiogroup", { name: "Period" });
    const chart = screen.getByRole("img", { name: /^Weigh-ins from/ });
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(card, period)).toBe(true);
    expect(follows(period, chart)).toBe(true);
  });

  it("the chart keeps a fixed height, so a resize never stretches it", async () => {
    await open();
    const chart = screen.getByRole("img", { name: /^Weigh-ins from/ });
    expect(chart.getAttribute("height")).toBe("180");
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
