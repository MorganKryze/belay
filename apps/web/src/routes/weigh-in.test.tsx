import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readOutbox, readWeights, recordChanges } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed, weight } from "../test/seed";

// Passes through, until a test makes the device refuse a write (a lost connection, a full disk).
vi.mock("../sync/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../sync/db")>();
  return { ...real, recordChanges: vi.fn(real.recordChanges) };
});
const refuseWrite = () =>
  vi.mocked(recordChanges).mockRejectedValueOnce(new DOMException("lost", "InvalidStateError"));
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

const row = () => screen.findByRole("button", { name: /^Weigh-in/ });
// The weigh-in sheet, opened from its line of the "Today" card.
async function openSheet() {
  // Awaited: the sheet's code may still be loading, and its render resumes inside this act.
  const line = await row();
  await act(async () => fireEvent.click(line));
  return screen.findByRole("dialog", { name: "Weigh-in" });
}
const field = () => screen.findByRole("textbox", { name: "Weight" });
const days = async () =>
  (await readWeights(await openAccountDb(ADA.id))).map((w) => [w.date, w.weightKg]);

describe("the weigh-in line and its sheet", () => {
  it("weighs in with two taps when the weight prefilled from the last weigh-in is right", async () => {
    await seed(ADA.id, [weight("2026-10-06", 80.2)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    await waitFor(async () => expect((await row()).textContent).toContain("not entered yet"));
    await openSheet();
    expect(((await field()) as HTMLInputElement).value).toBe("80.2");
    expect(screen.getByText("prefilled with your last weigh-in")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(async () => expect((await row()).textContent).toBe("Weigh-in 80.2\u00a0kg"));
    expect(screen.getByText("Weigh-in saved")).toBeTruthy();
    expect(await days()).toEqual([
      ["2026-10-06", 80.2],
      ["2026-10-07", 80.2],
    ]);
  });

  it("puts focus on the sheet's title, then back on the line once Save has closed it", async () => {
    await seed(ADA.id, [weight("2026-10-06", 80.2)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    (await row()).focus();
    await openSheet();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Weigh-in" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(await row());
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
    await openSheet();
    await waitFor(async () => expect(((await field()) as HTMLInputElement).value).toBe("80.2"));
  });

  it("starts empty for a first weigh-in, and Save waits for a value", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    await openSheet();
    expect(((await field()) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reads the French decimal comma", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.click(await screen.findByRole("button", { name: /^Pesée/ }));
    const input = await screen.findByRole("textbox", { name: "Poids" });
    fireEvent.change(input, { target: { value: "79,8" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(async () => expect(await days()).toEqual([["2026-10-07", 79.8]]));
  });

  it("refuses a weight typed without its decimal, and never saves it as 400 kg", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    await openSheet();
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
    await openSheet();
    const input = await field();
    fireEvent.change(input, { target: { value: "798" } });
    expect(await screen.findByText("Enter a weight between 20 and 400 kg.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await days()).toEqual([]);
    fireEvent.change(input, { target: { value: "79,8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" })); // no blur
    await waitFor(async () => expect(await days()).toEqual([["2026-10-07", 79.8]]));
  });

  it("undoes a first weigh-in of the day back to no weigh-in", async () => {
    const api = fakeApi({ me: ADA });
    renderRoute("/");
    await openSheet();
    fireEvent.change(await field(), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(async () => expect(await days()).toEqual([]));
    await waitFor(async () => expect((await row()).textContent).toContain("not entered yet"));
    // Already sent, or still queued: the opening sync, if still going, takes the 80 along.
    const db = await openAccountDb(ADA.id);
    const changes = [
      ...api.requests.flatMap((r) => r.changes),
      ...(await readOutbox(db)).map((e) => e.change),
    ];
    db.close();
    expect(changes.map((c) => (c.kind === "weight" ? c.weightKg : null))).toEqual([80, null]);
  });

  it("weighs in for a past day from the chip in the sheet's header, never a day after today", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    const sheet = await openSheet();
    const date = within(sheet).getByLabelText("Date of the weigh-in") as HTMLInputElement;
    expect(date.max).toBe("2026-10-07");
    expect(date.min).toBe("1900-01-01");
    fireEvent.change(date, { target: { value: "0202-10-05" } });
    expect(within(sheet).getByText("Today")).toBeTruthy(); // refused: still today
    fireEvent.change(date, { target: { value: "2026-10-08" } });
    expect(within(sheet).getByText("Today")).toBeTruthy(); // refused: still today
    fireEvent.change(date, { target: { value: "2026-10-05" } });
    expect(await within(sheet).findByText("Mon, Oct 5")).toBeTruthy();
    fireEvent.change(await field(), { target: { value: "80.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await days()).toEqual([["2026-10-05", 80.4]]));
    // The next sheet opens on today again.
    expect(within(await openSheet()).getByText("Today")).toBeTruthy();
  });

  it("files the morning weigh-in under the new day when the app stayed open overnight", async () => {
    vi.setSystemTime(new Date(2026, 9, 6, 23, 50));
    fakeApi({ me: ADA });
    renderRoute("/");
    await openSheet();
    fireEvent.change(await field(), { target: { value: "80.1" } });
    vi.setSystemTime(new Date(2026, 9, 7, 7, 5)); // no visibility event: the screen slept
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await days()).toEqual([["2026-10-07", 80.1]]));
  });
});

describe("when the phone refuses the write", () => {
  it("keeps the sheet and says so, with no false toast, then saves on the retry", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    await openSheet();
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
    const sheet = await openSheet();
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

  it("turns the toast into an error when the undo is refused, then undoes on the retry", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    await openSheet();
    fireEvent.change(await field(), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    refuseWrite();
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText(SAVE_FAILED)).toBeTruthy();
    expect(await days()).toEqual([["2026-10-07", 80]]);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(async () => expect(await days()).toEqual([]));
  });

  it("says so in French", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.click(await screen.findByRole("button", { name: /^Pesée/ }));
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

describe("deleting from the sheet", () => {
  it("deletes the day's weigh-in without asking, with an undo, and focus goes back to the line", async () => {
    await seed(ADA.id, [weight("2026-10-07", 80)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    (await row()).focus();
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete this weigh-in" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(await row());
    expect(screen.getByText("Weigh-in deleted")).toBeTruthy();
    await waitFor(async () => expect(await days()).toEqual([]));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect(await days()).toEqual([["2026-10-07", 80]]));
  });

  it("closes on Close, and gives focus back to the line", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    (await row()).focus();
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(await row());
  });
});

describe("in pounds", () => {
  beforeEach(() => localStorage.setItem("belay.weightUnit", "lb"));

  it("in pounds the weigh-in is typed in lb and saved in kg on the 0.1 grid", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    const sheet = await openSheet();
    expect(within(sheet).getByText("lb")).toBeTruthy();
    expect(within(sheet).queryByText("kg")).toBeNull();
    fireEvent.change(await field(), { target: { value: "180.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // 180.4 lb is 81.83 kg: stored as 81.8, read back as 180.25 lb.
    await waitFor(async () => expect(await days()).toEqual([["2026-10-07", 81.8]]));
    await waitFor(async () => expect((await row()).textContent).toBe("Weigh-in 180.25 lb"));
  });

  it("an untouched prefill in pounds saves the stored kg unchanged", async () => {
    await seed(ADA.id, [weight("2026-10-06", 80.2)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    await openSheet();
    // 80.2 kg is 176.81 lb, shown on the quarter pound.
    await waitFor(async () => expect(((await field()) as HTMLInputElement).value).toBe("176.75"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () =>
      expect(await days()).toEqual([
        ["2026-10-06", 80.2],
        ["2026-10-07", 80.2],
      ]),
    );
  });

  it("each tap of the stepper in pounds saves a different weigh-in", async () => {
    await seed(ADA.id, [weight("2026-10-06", 80.2)]);
    fakeApi({ me: ADA });
    renderRoute("/");
    const sheet = await openSheet();
    await waitFor(async () => expect(((await field()) as HTMLInputElement).value).toBe("176.75"));
    // A tenth of a pound would give 176.85 lb, 80.22 kg: back on the stored 80.2.
    fireEvent.click(within(sheet).getByRole("button", { name: "Increase Weight" }));
    expect(((await field()) as HTMLInputElement).value).toBe("177");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // 177 lb is 80.29 kg.
    await waitFor(async () =>
      expect(await days()).toEqual([
        ["2026-10-06", 80.2],
        ["2026-10-07", 80.3],
      ]),
    );
  });

  it("the out-of-range sentence says 44,25 and 881,75 lb", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.click(await screen.findByRole("button", { name: /^Pesée/ }));
    const input = await screen.findByRole("textbox", { name: "Poids" });
    fireEvent.change(input, { target: { value: "900" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Saisis un poids entre 44,25 et 881,75 lb.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // 44,25 lb is 20.1 kg, inside the bounds; 43,9 lb is 19.9 kg, outside.
    fireEvent.change(input, { target: { value: "43,9" } });
    expect(await screen.findByText("Saisis un poids entre 44,25 et 881,75 lb.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "44,25" } });
    await waitFor(() => expect(screen.queryByText(/^Saisis un poids/)).toBeNull());
  });
});
