import { addDays } from "@belay/shared/body/dates";
import type { Change } from "@belay/shared/sync/schema";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readIntake, readOutbox, readSupplementLogs } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

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

const AT = "2026-10-01T06:30:00.000Z";
const CREATINE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8f";
const VITAMIN = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90";
const IRON = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d91";
const named = (id: string, value: string): Change => ({
  kind: "supplement",
  id,
  field: "name",
  value,
  at: AT,
});
const tick = (supplementId: string, date: string): Change => ({
  kind: "supplementLog",
  supplementId,
  date,
  taken: true,
  at: AT,
});
const db = () => openAccountDb(ADA.id);
const line = (name: RegExp) => screen.findByRole("button", { name });

describe("the intake line and its sheet", () => {
  it("saves calories alone, then protein, and the line says both", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    expect((await line(/^Intake/)).textContent).toContain("not entered yet");
    fireEvent.click(await line(/^Intake/));
    const sheet = await screen.findByRole("dialog", { name: "Intake" });
    expect(within(sheet).getByText("One total per day, not food by food.")).toBeTruthy();
    const save = within(sheet).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // calories first
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Calories" }), {
      target: { value: "2100" },
    });
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Intake saved")).toBeTruthy();
    await waitFor(async () => expect((await line(/^Intake/)).textContent).toContain("2,100 kcal"));
    fireEvent.click(await line(/^Intake/));
    fireEvent.change(await screen.findByRole("textbox", { name: "Protein (optional)" }), {
      target: { value: "140" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () =>
      expect((await line(/^Intake/)).textContent).toContain("2,100 kcal · 140 g"),
    );
    expect(await readIntake(await db())).toEqual([
      { date: "2026-10-07", kcal: 2100, proteinG: 140 },
    ]);
  });

  it("prefills with the last entry, and an emptied protein deletes the day's value", async () => {
    await seed(ADA.id, [
      { kind: "intake", date: "2026-10-06", field: "kcal", value: 1900, at: AT },
      { kind: "intake", date: "2026-10-06", field: "protein", value: 120, at: AT },
    ]);
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.click(await line(/^Intake/));
    const kcal = (await screen.findByRole("textbox", { name: "Calories" })) as HTMLInputElement;
    await waitFor(() => expect(kcal.value).toBe("1900"));
    expect(screen.getByText(/Prefilled with your last entry\./)).toBeTruthy();
    // Yesterday's sheet: its own values, then the protein is emptied.
    fireEvent.change(screen.getByLabelText("Date of the intake"), {
      target: { value: "2026-10-06" },
    });
    const protein = await screen.findByRole("textbox", { name: "Protein (optional)" });
    fireEvent.change(protein, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () =>
      expect(await readIntake(await db())).toEqual([
        { date: "2026-10-06", kcal: 1900, proteinG: null },
      ]),
    );
  });

  it("refuses calories that are not a whole number in range", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.click(await line(/^Intake/));
    const kcal = await screen.findByRole("textbox", { name: "Calories" });
    fireEvent.change(kcal, { target: { value: "21000" } });
    expect(await screen.findByText("Enter a whole number between 0 and 10,000 kcal.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("deletes the day's intake, with an undo", async () => {
    await seed(ADA.id, [
      { kind: "intake", date: "2026-10-07", field: "kcal", value: 2100, at: AT },
    ]);
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.click(await line(/^Intake/));
    fireEvent.click(await screen.findByRole("button", { name: "Delete this day's intake" }));
    await waitFor(async () =>
      expect((await line(/^Intake/)).textContent).toContain("not entered yet"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await line(/^Intake/)).textContent).toContain("2,100 kcal"));
  });

  it("writes the numbers the French way", async () => {
    await i18n.changeLanguage("fr");
    await seed(ADA.id, [
      { kind: "intake", date: "2026-10-07", field: "kcal", value: 2100, at: AT },
      { kind: "intake", date: "2026-10-07", field: "protein", value: 140, at: AT },
    ]);
    fakeApi({ me: ADA });
    renderRoute("/");
    await waitFor(async () =>
      expect((await line(/^Apports/)).textContent).toContain("2\u202f100 kcal · 140 g"),
    );
  });
});

describe("the supplements line and its sheet", () => {
  it("leads to the list when there is none yet", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    const link = await screen.findByRole("link", { name: "Add your supplements" });
    expect(link.getAttribute("href")).toBe("/settings/supplements");
    expect(screen.queryByRole("button", { name: /^Supplements/ })).toBeNull();
  });

  it("ticks a box at once, shows the creatine course, and leaves out removed supplements", async () => {
    // Creatine taken every day from 29 September: today would be its 9th day.
    const days = Array.from({ length: 8 }, (_, i) => addDays("2026-09-29", i));
    await seed(ADA.id, [
      named(CREATINE, "Créatine"),
      named(VITAMIN, "Vitamine D"),
      named(IRON, "Fer"),
      { kind: "supplement", id: IRON, field: "removed", value: true, at: AT },
      ...days.map((d) => tick(CREATINE, d)),
    ]);
    fakeApi({ me: ADA });
    renderRoute("/");
    await waitFor(async () => expect((await line(/^Supplements/)).textContent).toContain("0 of 2"));
    fireEvent.click(await line(/^Supplements/));
    const sheet = await screen.findByRole("dialog", { name: "Supplements" });
    const boxes = within(sheet).getAllByRole("checkbox");
    expect(boxes.map((b) => b.closest("li")!.textContent)).toEqual(["Créatine", "Vitamine D"]);
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Créatine" }));
    expect(await within(sheet).findByText("for 9 days")).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Save" })).toBeNull(); // nothing to confirm
    await waitFor(async () =>
      expect(
        (await readSupplementLogs(await db())).filter((l) => l.date === "2026-10-07"),
      ).toHaveLength(1),
    );
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Créatine" }));
    await waitFor(async () =>
      expect((await readSupplementLogs(await db())).filter((l) => l.date === "2026-10-07")).toEqual(
        [],
      ),
    );
    expect(within(sheet).getByRole("link", { name: "Manage my list" }).getAttribute("href")).toBe(
      "/settings/supplements",
    );
  });
});

describe("the day's entries offline", () => {
  it("stay on the phone, queued, with the banner counting entries", async () => {
    await seed(ADA.id, [named(VITAMIN, "Vitamine D")]);
    const before = (await readOutbox(await db())).length;
    fakeApi({ me: "down" });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderRoute("/");
    fireEvent.click(await line(/^Intake/));
    fireEvent.change(await screen.findByRole("textbox", { name: "Calories" }), {
      target: { value: "2000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(await line(/^Supplements/));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Vitamine D" }));
    await waitFor(async () => expect((await readOutbox(await db())).length).toBe(before + 2));
    expect(await screen.findByText(/3 entries waiting/)).toBeTruthy();
  });
});
