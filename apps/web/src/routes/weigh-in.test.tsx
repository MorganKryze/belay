import { addDays } from "@belay/shared/body/dates";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readOutbox, readWeights } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed, weight } from "../test/seed";

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
