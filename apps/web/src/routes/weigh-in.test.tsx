import { addDays } from "@belay/shared/body/dates";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readOutbox, readWeights, recordChange } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed, weight } from "../test/seed";

// Passes through, until a test makes the device refuse a write (a lost connection, a full disk).
vi.mock("../sync/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../sync/db")>();
  return { ...real, recordChange: vi.fn(real.recordChange) };
});
const refuseWrite = () =>
  vi.mocked(recordChange).mockRejectedValueOnce(new DOMException("lost", "InvalidStateError"));
const SAVE_FAILED = "Couldn't save on this phone. Try again.";

// Wednesday 7 October 2026, 7:30 in the morning, on the phone's clock. Only Date is faked:
// fake-indexeddb runs on timers.
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

const card = () => screen.findByRole("region", { name: "Today's weigh-in" });
const field = () => screen.findByRole("textbox", { name: "Weight" });
const days = async () =>
  (await readWeights(await openAccountDb(ADA.id))).map((w) => [w.date, w.weightKg]);

describe("the weigh-in card", () => {
  it("weighs in with one tap when the weight prefilled from the last weigh-in is right", async () => {
    await seed(ADA.id, [weight("2026-10-06", 80.2)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    expect(((await field()) as HTMLInputElement).value).toBe("80.2");
    expect(screen.getByText("prefilled with your last weigh-in")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const done = await card();
    await within(done).findByText("saved");
    expect(done.textContent).toContain("80.2");
    expect(screen.getByText("Weigh-in saved")).toBeTruthy();
    expect(await days()).toEqual([
      ["2026-10-06", 80.2],
      ["2026-10-07", 80.2],
    ]);
  });

  it("puts focus on the card's heading once Save has gone", async () => {
    await seed(ADA.id, [weight("2026-10-06", 80.2)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    await field();
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.click(save);
    await within(await card()).findByText("saved");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Today's weigh-in" }));
  });

  it("fills the weight in once the first sync on a new phone brings the history", async () => {
    const api = fakeApi({ me: ADA });
    api.rows.set("2026-10-06", {
      date: "2026-10-06",
      weightKg: 80.2,
      at: "2026-10-06T05:00:00.000Z",
      seq: 1,
    });
    renderRoute("/");
    await waitFor(async () => expect(((await field()) as HTMLInputElement).value).toBe("80.2"));
  });

  it("starts empty for a first weigh-in, and Save waits for a value", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    expect(((await field()) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reads the French decimal comma", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/");
    const input = await screen.findByRole("textbox", { name: "Poids" });
    fireEvent.change(input, { target: { value: "79,8" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(async () => expect(await days()).toEqual([["2026-10-07", 79.8]]));
  });

  it("refuses a weight typed without its decimal, and never saves it as 400 kg", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    const input = await field();
    fireEvent.change(input, { target: { value: "798" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Enter a weight between 20 and 400 kg.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(await days()).toEqual([]);
  });

  it("saves what the field shows even when the tap on Save does not blur it", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    const input = await field();
    fireEvent.change(input, { target: { value: "798" } });
    expect(await screen.findByText("Enter a weight between 20 and 400 kg.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await days()).toEqual([]);
    fireEvent.change(input, { target: { value: "79,8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" })); // no blur
    await waitFor(async () => expect(await days()).toEqual([["2026-10-07", 79.8]]));
  });

  it("undoes a first weigh-in of the day back to no weigh-in", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.change(await field(), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(async () => expect(await days()).toEqual([]));
    expect(await field()).toBeTruthy(); // the card asks again
    const queued = (await readOutbox(await openAccountDb(ADA.id))).map((e) => e.change);
    expect(queued.map((c) => (c.kind === "weight" ? c.weightKg : null))).toEqual([80, null]);
  });

  it("weighs in for a past day from the date chip, never a day after today", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    const date = (await screen.findByLabelText("Date of the weigh-in")) as HTMLInputElement;
    expect(date.max).toBe("2026-10-07");
    expect(date.min).toBe("1900-01-01");
    fireEvent.change(date, { target: { value: "0202-10-05" } });
    expect(screen.getByText("Today")).toBeTruthy(); // refused: still today
    fireEvent.change(date, { target: { value: "2026-10-08" } });
    expect(screen.getByText("Today")).toBeTruthy(); // refused: still today
    fireEvent.change(date, { target: { value: "2026-10-05" } });
    expect(await screen.findByText("Mon, Oct 5")).toBeTruthy();
    fireEvent.change(await field(), { target: { value: "80.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await days()).toEqual([["2026-10-05", 80.4]]));
    expect(await screen.findByText("Today")).toBeTruthy(); // the card is back on today
  });

  it("files the morning weigh-in under the new day when the app stayed open overnight", async () => {
    vi.setSystemTime(new Date(2026, 9, 6, 23, 50));
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.change(await field(), { target: { value: "80.1" } });
    vi.setSystemTime(new Date(2026, 9, 7, 7, 5)); // no visibility event: the screen slept
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await days()).toEqual([["2026-10-07", 80.1]]));
  });
});

describe("when the phone refuses the write", () => {
  it("keeps the form and says so, with no false toast, then saves on the retry", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.change(await field(), { target: { value: "80" } });
    refuseWrite();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe(SAVE_FAILED);
    expect(screen.queryByText("Weigh-in saved")).toBeNull();
    expect(((await field()) as HTMLInputElement).value).toBe("80");
    expect(await days()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await days()).toEqual([["2026-10-07", 80]]));
    expect(await screen.findByText("Weigh-in saved")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the sheet open on a failed save and on a failed delete", async () => {
    await seed(ADA.id, [weight("2026-10-07", 80)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog");
    refuseWrite();
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete this weigh-in" }));
    expect((await within(sheet).findByRole("alert")).textContent).toBe(SAVE_FAILED);
    expect(screen.queryByText("Weigh-in deleted")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
    refuseWrite();
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(sheet).getByRole("alert").textContent).toBe(SAVE_FAILED));
    expect(screen.queryByText("Weigh-in saved")).toBeNull();
    expect(await days()).toEqual([["2026-10-07", 80]]);
  });

  it("keeps the toast and says so when the undo is refused, then undoes on the retry", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.change(await field(), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    refuseWrite();
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText(SAVE_FAILED)).toBeTruthy();
    expect(await days()).toEqual([["2026-10-07", 80]]);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect(await days()).toEqual([]));
  });

  it("says so in French", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.change(await screen.findByRole("textbox", { name: "Poids" }), {
      target: { value: "80" },
    });
    refuseWrite();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Pas pu enregistrer sur ce téléphone. Réessaie.",
    );
  });
});

describe("the edit sheet", () => {
  it("opens on Edit and gives focus back to it when closed", async () => {
    await seed(ADA.id, [weight("2026-10-07", 80)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    const edit = await screen.findByRole("button", { name: "Edit" });
    edit.focus();
    fireEvent.click(edit);
    const sheet = await screen.findByRole("dialog", { name: "Today's weigh-in" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" }));
  });

  it("deletes the day's weigh-in without asking, with an undo", async () => {
    await seed(ADA.id, [weight("2026-10-07", 80)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete this weigh-in" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The Edit button is gone with the weigh-in: focus lands on the card's heading.
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Today's weigh-in" }));
    expect(screen.getByText("Weigh-in deleted")).toBeTruthy();
    await waitFor(async () => expect(await days()).toEqual([]));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect(await days()).toEqual([["2026-10-07", 80]]));
  });
});

describe("the trend card", () => {
  it("shows the 7-day average and the last complete week's loss, with a link to Body", async () => {
    const week = (monday: string, kg: number) =>
      [0, 1, 2, 3].map((d) => weight(addDays(monday, d), kg));
    await seed(ADA.id, [...week("2026-09-21", 80.3), ...week("2026-09-28", 79.8)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    const trend = await screen.findByRole("region", { name: "Your trend" });
    await waitFor(() => expect(trend.textContent).toContain("7-day average 79.8\u00a0kg"));
    expect(trend.textContent).toContain("loss 0.6%/wk");
    expect(within(trend).getByRole("link", { name: "Body" }).getAttribute("href")).toBe("/body");
  });

  it("speaks of a gain in neutral words", async () => {
    await i18n.changeLanguage("fr");
    const week = (monday: string, kg: number) =>
      [0, 1, 2, 3].map((d) => weight(addDays(monday, d), kg));
    await seed(ADA.id, [...week("2026-09-21", 80.3), ...week("2026-09-28", 80.5)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    const trend = await screen.findByRole("region", { name: "Ta tendance" });
    await waitFor(() => expect(trend.textContent).toContain("prise 0,2 %/sem"));
  });
});
