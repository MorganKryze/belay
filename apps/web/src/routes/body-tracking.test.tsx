import { addDays } from "@belay/shared/body/dates";
import type { Change } from "@belay/shared/sync/schema";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readAnnotations, readMeasures, readOutbox } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed, weight } from "../test/seed";

const AT = "2026-10-01T06:30:00.000Z";
const CREATINE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8f";
const NOTE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90";
const days = (first: string, kgs: number[]) => kgs.map((kg, i) => weight(addDays(first, i), kg));
// Three complete weeks before Wednesday 7 October 2026, and three days of this week.
const WEEKS = [
  ...days("2026-09-14", [81, 81, 81, 81]),
  ...days("2026-09-21", [80.8, 80.8, 80.8, 80.8]),
  ...days("2026-09-28", [80.2, 80.2, 80.2, 80.2]),
  ...days("2026-10-05", [80, 79.9, 79.8]),
];
const intake = (date: string, kcal: number): Change => ({
  kind: "intake",
  date,
  field: "kcal",
  value: kcal,
  at: AT,
});
const waist = (date: string, value: number): Change => ({
  kind: "measure",
  date,
  field: "waist",
  value,
  at: AT,
});

beforeEach(() => {
  indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 8, 0));
  writeLastUser(ADA);
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

// Offline by default: what the person enters stays in the queue for the test to read.
async function open(changes: Change[], me: typeof ADA | "down" = "down") {
  await seed(ADA.id, [...WEEKS, ...changes]);
  fakeApi({ me });
  renderRoute("/body");
  return screen.findByRole("region", { name: "Your weeks" });
}
const week = (list: HTMLElement, i: number) => within(list).getAllByRole("listitem")[i]!;
const db = () => openAccountDb(ADA.id);

describe("Your weeks", () => {
  it("show the week's last waist and its intake average, with the days entered", async () => {
    const list = await open([
      waist("2026-09-29", 83),
      waist("2026-10-02", 82.5),
      ...["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map((d, i) =>
        intake(d, 2000 + i * 50),
      ),
    ]);
    expect(week(list, 1).textContent).toContain("Waist82.5 cm");
    expect(week(list, 1).textContent).toContain("Intake (5 d)2,100 kcal");
    expect(week(list, 2).textContent).toContain("Waist—Intake—");
  });

  it("mark the weeks of a creatine course, and say once what it does to the scale", async () => {
    const list = await open([
      { kind: "supplement", id: CREATINE, field: "name", value: "Créatine", at: AT },
      ...["2026-10-01", "2026-10-02"].map((date): Change => ({
        kind: "supplementLog",
        supplementId: CREATINE,
        date,
        taken: true,
        at: AT,
      })),
    ]);
    expect(week(list, 0).textContent).toContain("creatine"); // the course runs to 14 October
    expect(week(list, 1).textContent).toContain("creatine");
    expect(week(list, 2).textContent).not.toContain("creatine");
    expect(
      screen.getByText(
        "During the 14 days of creatine, the weight often rises by 1 to 2 kg of water: it isn't fat.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("creatine · 14 d")).toBeTruthy(); // the band on the chart
  });

  it("open an annotation from its pill, and delete it with an undo", async () => {
    const list = await open([
      {
        kind: "annotation",
        id: NOTE,
        field: "fields",
        date: "2026-09-22",
        type: "diet_break",
        label: null,
        at: AT,
      },
    ]);
    fireEvent.click(
      within(week(list, 2)).getByRole("button", { name: "Open the annotation Break" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Annotation" });
    expect(within(sheet).getByRole("radio", { name: "Break" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete this annotation" }));
    await waitFor(async () => expect(await readAnnotations(await db())).toEqual([]));
    expect(await screen.findByText("Annotation deleted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect(await readAnnotations(await db())).toHaveLength(1));
  });
});

describe("the annotation sheet", () => {
  it("adds a named note on a past day, drawn on the chart and pinned to its week", async () => {
    const list = await open([]);
    fireEvent.click(screen.getByRole("button", { name: "Annotation" }));
    const sheet = await screen.findByRole("dialog", { name: "New annotation" });
    expect(document.activeElement).toBe(
      within(sheet).getByRole("heading", { name: "New annotation" }),
    );
    expect(
      within(sheet).getByText(
        "Creatine needs no annotation: it comes from the supplements you tick.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Note" }));
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Text (optional)" }), {
      target: { value: "trip to Lisbon" },
    });
    fireEvent.change(within(sheet).getByLabelText("Date of the annotation"), {
      target: { value: "2026-09-30" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const [stored] = await readAnnotations(await db());
    expect(stored).toMatchObject({ date: "2026-09-30", type: "note", label: "trip to Lisbon" });
    // Cut to 12 characters on the chart and on the week's pill.
    expect(await within(week(list, 1)).findByText("trip to Lisb…")).toBeTruthy();
    expect(screen.getAllByText("trip to Lisb…")).toHaveLength(2);
  });
});

describe("the measurements sheet", () => {
  it("saves the waist, and the neck if given, then the history says so", async () => {
    await open([]);
    fireEvent.click(screen.getByRole("button", { name: "Measurements" }));
    const sheet = await screen.findByRole("dialog", { name: "Measurements" });
    expect(
      within(sheet).getByText(
        "At the navel for the male formula, at the narrowest for the female formula.",
      ),
    ).toBeTruthy();
    const save = within(sheet).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // the waist first
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Waist" }), {
      target: { value: "82" },
    });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Neck (optional)" }), {
      target: { value: "39,5" },
    });
    fireEvent.click(save);
    await waitFor(async () =>
      expect(await readMeasures(await db())).toEqual([
        { date: "2026-10-07", waistCm: 82, neckCm: 39.5, hipCm: null },
      ]),
    );
    const queued = (await readOutbox(await db())).map((e) => e.change.kind);
    expect(queued.filter((k) => k === "measure")).toHaveLength(2); // no hip written
    const history = screen.getByRole("region", { name: "History" });
    // Testing Library folds the no-break spaces into plain ones.
    expect(await within(history).findByText("79.8 kg · waist 82 cm · neck 39.5 cm")).toBeTruthy();
  });

  it("refuses a waist outside 40 to 200 cm", async () => {
    await open([]);
    fireEvent.click(screen.getByRole("button", { name: "Measurements" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Waist" }), {
      target: { value: "820" },
    });
    expect(await screen.findByText("Enter between 40 and 200 cm, to the tenth.")).toBeTruthy();
  });
});

describe("the history", () => {
  it("lists every day with an entry, and opens the weigh-in of a day weighed", async () => {
    await open([intake("2026-10-07", 2100), intake("2026-10-04", 1800)]);
    const history = screen.getByRole("region", { name: "History" });
    // Units stay on their number with a no-break space; compared here as plain spaces.
    const lines = within(history)
      .getAllByRole("listitem")
      .map((li) => li.textContent!.replace(/\s/g, " "));
    expect(lines[0]).toBe("Today79.8 kg · 2,100 kcal");
    expect(lines).toContain("Sun, Oct 41,800 kcal"); // not weighed: a line, no button
    expect(within(history).queryByRole("button", { name: /^Sun, Oct 4/ })).toBeNull();
    fireEvent.click(within(history).getByRole("button", { name: /^Today/ }));
    expect(await screen.findByRole("dialog", { name: "Weigh-in" })).toBeTruthy();
  });
});
