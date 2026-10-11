import type { Change } from "@belay/shared/sync/schema";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readActivities, readOutbox, readSteps } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

// Wednesday 7 October 2026, 19:30 on the phone's clock.
beforeEach(() => {
  indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 19, 30));
  writeLastUser(ADA);
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const AT = "2026-10-06T18:00:00.000Z";
const CLIMB = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7da1";
const climb = (patch: Record<string, unknown> = {}): Change =>
  ({
    kind: "activity",
    id: CLIMB,
    field: "fields",
    date: "2026-10-07",
    type: "climbing",
    durationMin: 90,
    cardioType: null,
    climbStyle: "boulder",
    climbRuns: 14,
    climbGrade: "6b+",
    climbColor: null,
    at: AT,
    ...patch,
  }) as Change;
const line = () => screen.findByRole("button", { name: /^Activity/ });
const sheet = () => screen.findByRole("dialog", { name: "Activity" });
const db = () => openAccountDb(ADA.id);
// Still queued, or already sent: the opening sync, if still going, takes it along.
const recorded = async (api: ReturnType<typeof fakeApi>) => {
  const d = await db();
  const out = [
    ...api.requests.flatMap((r) => r.changes),
    ...(await readOutbox(d)).map((e) => e.change),
  ];
  d.close();
  return out;
};

describe("Home's activity line (§4.1)", () => {
  it("says nothing is entered yet, then logs a climb in two taps", async () => {
    await seed(ADA.id, [climb({ date: "2026-10-03" })]); // last Saturday's, for the prefill
    const api = fakeApi({ me: ADA });
    renderRoute("/");
    expect((await line()).textContent).toContain("not entered yet");
    fireEvent.click(await line());
    const s = await sheet();
    // Climbing first, every field prefilled from the last climb.
    expect(within(s).getByRole("radio", { name: "Climbing" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(within(s).getByRole("spinbutton", { name: "Duration" }).textContent).toBe("1 h 30");
    expect(
      (within(s).getByRole("textbox", { name: "Routes or boulders" }) as HTMLInputElement).value,
    ).toBe("14");
    expect(within(s).getByRole("radio", { name: "6b+" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(s).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Activity saved")).toBeTruthy();
    await waitFor(async () =>
      expect((await line()).textContent).toContain("Climbing · 1 h 30 · 6b+"),
    );
    expect(
      (await recorded(api)).filter(
        (c) => c.kind === "activity" && c.field === "fields" && c.date === "2026-10-07",
      ),
    ).toEqual([expect.objectContaining({ field: "fields", type: "climbing", durationMin: 90 })]);
  });

  it("logs a cardio session, remembers the segment, and counts two activities", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.click(await line());
    let s = await sheet();
    fireEvent.click(within(s).getByRole("radio", { name: "Cardio" }));
    fireEvent.click(within(s).getByRole("radio", { name: "Bike" }));
    expect(within(s).getByRole("spinbutton", { name: "Duration" }).textContent).toBe("45 min");
    fireEvent.click(within(s).getByRole("button", { name: "Increase Duration" }));
    fireEvent.click(within(s).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await line()).textContent).toContain("Bike · 50 min"));
    // Cardio again first, and the session of the day to pick, or another one.
    fireEvent.click(await line());
    s = await sheet();
    expect(within(s).getByRole("radio", { name: "Cardio" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    const day = within(s).getByRole("radiogroup", { name: "On this day" });
    expect(within(day).getByRole("radio", { name: "Bike · 50 min" })).toBeTruthy();
    fireEvent.click(within(day).getByRole("radio", { name: "Another cardio session" }));
    fireEvent.click(within(s).getByRole("radio", { name: "Run" }));
    fireEvent.click(within(s).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await line()).textContent).toContain("2 activities"));
    expect((await readActivities(await db())).map((a) => a.cardioType)).toEqual(["bike", "run"]);
  });

  it("keeps the day's steps, typed by hand, and empties them", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.click(await line());
    const s = await sheet();
    fireEvent.click(within(s).getByRole("radio", { name: "Steps" }));
    const field = within(s).getByRole("textbox", { name: "Steps of the day" });
    expect(within(s).getByText("Copy them from your phone or your watch.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "100001" } });
    expect(within(s).getByText("Enter a whole number between 0 and 100,000.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "8437" } });
    fireEvent.click(within(s).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await line()).textContent).toContain("8,437 steps"));
    fireEvent.click(await line());
    fireEvent.change(await screen.findByRole("textbox", { name: "Steps of the day" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await line()).textContent).toContain("not entered yet"));
    expect(await readSteps(await db())).toEqual([]);
  });

  it("reopens the day's climb to edit it in a colour, and deletes it after asking", async () => {
    await seed(ADA.id, [climb()]);
    fakeApi({ me: ADA });
    renderRoute("/");
    await waitFor(async () => expect((await line()).textContent).toContain("6b+"));
    fireEvent.click(await line());
    let s = await sheet();
    fireEvent.click(within(s).getByRole("radio", { name: "Color" }));
    const colors = within(s).getByRole("radiogroup", { name: "Color" });
    expect(within(colors).getAllByRole("radio")).toHaveLength(7);
    fireEvent.click(within(colors).getByRole("radio", { name: "blue" }));
    expect(within(s).getByText("blue")).toBeTruthy(); // written out under the dots
    fireEvent.click(within(s).getByRole("button", { name: "Save" }));
    await waitFor(async () =>
      expect((await line()).textContent).toContain("Climbing · 1 h 30 · blue"),
    );
    fireEvent.click(await line());
    s = await sheet();
    fireEvent.click(within(s).getByRole("button", { name: "Delete this activity" }));
    const ask = within(s).getByRole("group", { name: "Delete this activity?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect((await line()).textContent).toContain("not entered yet"));
    // The undo brings it back.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await line()).textContent).toContain("blue"));
  });

  it("logs an activity on an earlier day, never after today", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    fireEvent.click(await line());
    const s = await sheet();
    const date = within(s).getByLabelText("Date of the activity") as HTMLInputElement;
    expect(date.max).toBe("2026-10-07");
    fireEvent.change(date, { target: { value: "2026-10-05" } });
    fireEvent.click(within(s).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await line()).textContent).toContain("not entered yet");
    expect((await readActivities(await db())).map((a) => a.date)).toEqual(["2026-10-05"]);
  });

  it("speaks French, with the narrow space before the question mark", async () => {
    await seed(ADA.id, [climb()]);
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/");
    const row = await screen.findByRole("button", { name: /^Activité/ });
    await waitFor(() => expect(row.textContent).toContain("Escalade · 1 h 30 · 6b+"));
    fireEvent.click(row);
    const s = await screen.findByRole("dialog", { name: "Activité" });
    expect(within(s).getByRole("radio", { name: "Bloc" })).toBeTruthy();
    expect(within(s).getByText("Le plus dur")).toBeTruthy();
    fireEvent.click(within(s).getByRole("button", { name: "Supprimer cette activité" }));
    expect(within(s).getByRole("group").textContent).toContain("Supprimer cette activité ?");
  });
});
