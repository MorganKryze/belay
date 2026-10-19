import { addDays } from "@belay/shared/body/dates";
import type { Change } from "@belay/shared/sync/schema";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { motion } from "../lib/motion";
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
  vi.restoreAllMocks();
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
    expect(screen.getByText("Creatine")).toBeTruthy(); // its legend
  });

  it("leave the creatine out of the legend when no course reaches the period shown", async () => {
    await open([
      { kind: "supplement", id: CREATINE, field: "name", value: "Créatine", at: AT },
      {
        kind: "supplementLog",
        supplementId: CREATINE,
        date: "2026-05-01",
        taken: true,
        at: AT,
      },
    ]);
    expect(screen.queryByText("Creatine")).toBeNull();
    expect(screen.queryByText("creatine · 14 d")).toBeNull();
  });
});

const note = (id: string, date: string, type = "diet_break"): Change =>
  ({ kind: "annotation", id, field: "fields", date, type, label: null, at: AT }) as Change;
const chart = () => screen.getByRole("img", { name: /^Weigh-ins from/ });
const annotationsList = () => screen.getByRole("region", { name: "Annotations" });

describe("the chart", () => {
  it("says the creatine course and the annotations in its summary", async () => {
    await open([
      { kind: "supplement", id: CREATINE, field: "name", value: "Créatine", at: AT },
      {
        kind: "supplementLog",
        supplementId: CREATINE,
        date: "2026-10-01",
        taken: true,
        at: AT,
      },
      note(NOTE, "2026-09-22"),
    ]);
    const label = chart().getAttribute("aria-label")!;
    expect(label).toContain("Creatine Oct 1 to Oct 7.");
    expect(label).toContain("Annotation Break, Sep 22.");
  });

  // jsdom has no layout: the drawing is 320 wide at scale 1, from Sep 8 to Oct 7, its plot from
  // 26 to 286; a name's box is 14 tall above its baseline, 150 at the bottom and 17 in the strip.
  const LATER = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d91";
  const lineX = (day: number) => 26 + (260 * day) / 29;
  const opened = async (type: string) => {
    const sheet = await screen.findByRole("dialog", { name: "Annotation" });
    expect(within(sheet).getByRole("radio", { name: type }).getAttribute("aria-checked")).toBe(
      "true",
    );
  };

  it("opens an annotation from a tap on its name under the curve", async () => {
    await open([note(NOTE, "2026-09-22")]);
    fireEvent.click(chart(), { clientX: lineX(14) + 12, clientY: 144 });
    await opened("Break");
  });

  it("a name raised into the strip opens from there", async () => {
    await open([note(NOTE, "2026-09-22"), note(LATER, "2026-09-23", "deload")]);
    const raised = chart().querySelector("text[data-level=top]");
    expect(raised?.textContent).toBe("Deload");
    fireEvent.click(chart(), { clientX: lineX(15), clientY: 14 });
    await opened("Deload");
  });

  it("writes the last 7-day average at the end of its line", async () => {
    await open([]);
    // Oct 1 at 80.2, Oct 5 to 7 at 80, 79.9 and 79.8: an average of 79.975.
    expect(chart().textContent).toContain("80.0");
  });
});

describe("the annotation sheet", () => {
  it("adds a named note on a past day, drawn on the chart and listed", async () => {
    await open([]);
    fireEvent.click(screen.getByRole("button", { name: /^Annotation\b/ }));
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
    // Cut to 12 characters on the chart and on its row.
    expect(await within(annotationsList()).findByText("trip to Lisb…")).toBeTruthy();
    expect(screen.getAllByText("trip to Lisb…")).toHaveLength(2);
  });
});

describe("Log", () => {
  const log = () => screen.getByRole("region", { name: "Log" });
  // Only the entries given, without the three weeks: a day with no weigh-in, or no data at all.
  const openWith = async (changes: Change[]) => {
    await seed(ADA.id, changes);
    fakeApi({ me: "down" });
    renderRoute("/body");
    return screen.findByRole("region", { name: "Log" });
  };

  it("Log lists Weigh-in, Measurements and Annotation, each opening its sheet", async () => {
    await open([]);
    const rows = within(log()).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Weigh-in/),
      expect.stringMatching(/^Measurements/),
      expect.stringMatching(/^Annotation/),
    ]);
    for (const [i, name] of ["Weigh-in", "Measurements", "New annotation"].entries()) {
      fireEvent.click(within(log()).getAllByRole("button")[i]!);
      const sheet = await screen.findByRole("dialog", { name });
      fireEvent.keyDown(sheet, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).toBeNull());
    }
  });

  it("the Weigh-in row says today's weight, else not entered yet", async () => {
    await open([]);
    expect(within(log()).getByRole("button", { name: /^Weigh-in 79\.8\skg$/ })).toBeTruthy();
    cleanup();
    indexedDB = new IDBFactory();
    const empty = await openWith([weight("2026-10-06", 80)]);
    expect(within(empty).getByRole("button", { name: "Weigh-in not entered yet" })).toBeTruthy();
  });

  it("the Measurements row says the latest waist and its day, else not entered yet", async () => {
    await open([waist("2026-09-29", 83), waist("2026-10-02", 82.5), waist("2026-10-09", 81)]);
    expect(
      within(log()).getByRole("button", { name: /^Measurements waist 82\.5\scm · Fri, Oct 2$/ }),
    ).toBeTruthy();
    cleanup();
    indexedDB = new IDBFactory();
    await openWith([
      waist("2026-09-29", 83),
      { kind: "measure", date: "2026-10-03", field: "neck", value: 39, at: AT },
    ]);
    // A day without a waist says its neck.
    expect(
      within(log()).getByRole("button", { name: /^Measurements neck 39\scm · Sat, Oct 3$/ }),
    ).toBeTruthy();
    cleanup();
    indexedDB = new IDBFactory();
    await openWith([]);
    expect(
      within(log()).getByRole("button", { name: "Measurements not entered yet" }),
    ).toBeTruthy();
  });

  it("before the first sync the two statuses are blank", async () => {
    // The 4 s cap counts from the start of the visit: here, the start of the test.
    const now = performance.now.bind(performance);
    const start = now();
    vi.spyOn(performance, "now").mockImplementation(() => now() - start);
    // A device that never synced, its first sync still unanswered.
    fakeApi({ me: ADA, sync: () => new Promise<Response>(() => {}) });
    renderRoute("/body");
    const list = await screen.findByRole("region", { name: "Log" });
    const [weighIn, measures, annotation] = within(list).getAllByRole("button");
    for (const row of [weighIn!, measures!]) {
      expect(row.textContent).not.toContain("not entered yet");
      expect(row.querySelector("span[aria-hidden].text-\\[13px\\]")!.textContent).toBe("\u00a0");
    }
    expect(annotation!.textContent).toContain("deload week, break or note");
  });

  it("a weight saved from the Weigh-in row shows on the row before the sheet leaves", async () => {
    vi.spyOn(motion, "exitWillAnimate").mockReturnValue(true);
    // Hold the sheet's 400 ms fallback, so the slow test machine cannot end the exit early.
    const timeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void,
      ms?: number,
      ...args: unknown[]
    ) => (ms === 400 ? 0 : timeout(fn, ms, ...args))) as typeof setTimeout);
    await open([]);
    fireEvent.click(within(log()).getByRole("button", { name: /^Weigh-in/ }));
    const sheet = await screen.findByRole("dialog", { name: "Weigh-in" });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Weight" }), {
      target: { value: "79.5" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Weigh-in/, hidden: true }).textContent).toContain(
        "79.5\u00a0kg",
      ),
    );
    const leaving = screen.getByRole("dialog", { hidden: true });
    expect(leaving.getAttribute("data-state")).toBe("closed");
    fireEvent.animationEnd(leaving);
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("the grey buttons are gone", async () => {
    await open([]);
    expect(screen.queryByRole("button", { name: "Measurements" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Annotation" })).toBeNull();
    expect(document.querySelector("main svg.lucide-plus")).toBeNull();
  });
});

describe("Annotations", () => {
  const LATER = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d91";
  const OLD = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d92";
  const named = (id: string, date: string, label: string | null): Change => ({
    kind: "annotation",
    id,
    field: "fields",
    date,
    type: "note",
    label,
    at: AT,
  });

  it("lists the period's annotations, newest first, each opening its sheet", async () => {
    await open([
      note(NOTE, "2026-09-22"),
      note(LATER, "2026-10-01", "deload"),
      note(OLD, "2026-08-01"),
    ]);
    const rows = within(annotationsList()).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["Deload Thu, Oct 1", "Break Tue, Sep 22"]);
    for (const [i, type] of ["Deload", "Break"].entries()) {
      fireEvent.click(within(annotationsList()).getAllByRole("button")[i]!);
      const sheet = await screen.findByRole("dialog", { name: "Annotation" });
      expect(within(sheet).getByRole("radio", { name: type }).getAttribute("aria-checked")).toBe(
        "true",
      );
      fireEvent.keyDown(sheet, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).toBeNull());
    }
  });

  it("a note named by its text says Note before its day", async () => {
    await open([named(NOTE, "2026-09-30", "trip to Lisbon"), named(LATER, "2026-10-02", null)]);
    const list = annotationsList();
    expect(
      within(list).getByRole("button", { name: "trip to Lisb… Note · Wed, Sep 30" }),
    ).toBeTruthy();
    expect(within(list).getByRole("button", { name: "Note Fri, Oct 2" })).toBeTruthy();
  });

  it("an annotation before the first week is still listed", async () => {
    await open([note(NOTE, "2026-09-10")]); // inside the month, before the first week
    fireEvent.click(within(annotationsList()).getByRole("button", { name: /^Break / }));
    expect(await screen.findByRole("dialog", { name: "Annotation" })).toBeTruthy();
    cleanup();
    indexedDB = new IDBFactory();
    // Before 4 weigh-ins, with no weeks at all.
    await seed(ADA.id, [weight("2026-10-06", 80), note(NOTE, "2026-10-05")]);
    fakeApi({ me: "down" });
    renderRoute("/body");
    expect(
      await within(await screen.findByRole("region", { name: "Annotations" })).findByRole(
        "button",
        { name: /^Break / },
      ),
    ).toBeTruthy();
  });

  it("the weeks carry no annotation pill", async () => {
    const list = await open([note(NOTE, "2026-09-22")]);
    expect(within(list).queryByRole("button", { name: /Break/ })).toBeNull();
    expect(within(list).queryByText("Break")).toBeNull();
  });

  it("open an annotation from its row, and delete it with an undo", async () => {
    await open([note(NOTE, "2026-09-22")]);
    fireEvent.click(within(annotationsList()).getByRole("button", { name: /^Break / }));
    const sheet = await screen.findByRole("dialog", { name: "Annotation" });
    expect(within(sheet).getByRole("radio", { name: "Break" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete this annotation" }));
    await waitFor(async () => expect(await readAnnotations(await db())).toEqual([]));
    expect(await screen.findByText("Annotation deleted")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Annotations" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect(await readAnnotations(await db())).toHaveLength(1));
    expect(
      await within(await screen.findByRole("region", { name: "Annotations" })).findByRole(
        "button",
        { name: /^Break / },
      ),
    ).toBeTruthy();
  });
});

describe("the measurements sheet", () => {
  it("saves the waist, and the neck if given, then the history says so", async () => {
    await open([]);
    fireEvent.click(screen.getByRole("button", { name: /^Measurements\b/ }));
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
    expect(await within(history).findByText("waist 82 cm ·")).toBeTruthy();
    expect(within(history).getByText("neck 39.5 cm")).toBeTruthy();
    expect(within(history).getByText("79.8 kg")).toBeTruthy(); // the weight stays with the day
  });

  it("saved measures show on Body before the sheet leaves", async () => {
    vi.spyOn(motion, "exitWillAnimate").mockReturnValue(true);
    // Hold the sheet's 400 ms fallback, so the slow test machine cannot end the exit early.
    const timeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void,
      ms?: number,
      ...args: unknown[]
    ) => (ms === 400 ? 0 : timeout(fn, ms, ...args))) as typeof setTimeout);
    await open([]);
    fireEvent.click(screen.getByRole("button", { name: /^Measurements\b/ }));
    const sheet = await screen.findByRole("dialog", { name: "Measurements" });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Waist" }), {
      target: { value: "82" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    // Only the history writes this line; a text query sees it under the open dialog.
    expect(await screen.findByText("waist 82 cm")).toBeTruthy();
    const leaving = screen.getByRole("dialog", { hidden: true });
    expect(leaving.getAttribute("data-state")).toBe("closed");
    fireEvent.animationEnd(leaving);
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("refuses a waist outside 40 to 200 cm", async () => {
    await open([]);
    fireEvent.click(screen.getByRole("button", { name: /^Measurements\b/ }));
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
    expect(lines[0]).toBe("Today79.8 kg2,100 kcal");
    expect(lines).toContain("Sun, Oct 41,800 kcal"); // not weighed: a line, no button
    expect(within(history).queryByRole("button", { name: /^Sun, Oct 4/ })).toBeNull();
    fireEvent.click(within(history).getByRole("button", { name: /^Today/ }));
    expect(await screen.findByRole("dialog", { name: "Weigh-in" })).toBeTruthy();
  });

  it("reads a crowded day on two lines, its parts never broken", async () => {
    await open([
      intake("2026-10-07", 2100),
      { kind: "intake", date: "2026-10-07", field: "protein", value: 140, at: AT },
      { kind: "measure", date: "2026-10-07", field: "waist", value: 82, at: AT },
      { kind: "measure", date: "2026-10-07", field: "neck", value: 39.5, at: AT },
      { kind: "measure", date: "2026-10-07", field: "hip", value: 98, at: AT },
    ]);
    const history = screen.getByRole("region", { name: "History" });
    const row = within(history).getByRole("button", { name: /^Today/ });
    const [first, second] = Array.from(row.children) as HTMLElement[];
    // Line 1: the day on the left, the weight on the right.
    expect(first!.children[0]!.textContent).toBe("Today");
    expect(first!.children[1]!.textContent).toMatch(/^79\.8\skg$/);
    // Line 2: the other parts, muted, wrapping only between parts.
    expect(second!.className).toContain("flex-wrap");
    expect(second!.className).toContain("text-muted-foreground");
    const parts = Array.from(second!.children) as HTMLElement[];
    expect(parts).toHaveLength(5);
    for (const part of parts) expect(part.className).toContain("whitespace-nowrap");
    expect(parts.map((p) => p.textContent!.replace(/\s/g, " "))).toEqual([
      "2,100 kcal ·",
      "140 g protein ·",
      "waist 82 cm ·",
      "neck 39.5 cm ·",
      "hips 98 cm",
    ]);
  });

  it("says the protein of a day with nothing else", async () => {
    await open([{ kind: "intake", date: "2026-10-03", field: "protein", value: 140, at: AT }]);
    const history = screen.getByRole("region", { name: "History" });
    const lines = within(history)
      .getAllByRole("listitem")
      .map((li) => li.textContent!.replace(/\s/g, " "));
    expect(lines).toContain("Sat, Oct 3140 g protein");
  });
});
