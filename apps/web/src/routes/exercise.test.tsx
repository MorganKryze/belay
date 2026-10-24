import type { Change } from "@belay/shared/sync/schema";
import { DEFAULT_SCHEDULE, SEED_PROGRAM_ID } from "@belay/shared/training/stored-program";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { writeMedia } from "../lib/media-flag";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

beforeEach(() => {
  indexedDB = new IDBFactory();
  writeLastUser(ADA);
  fakeApi({ me: ADA });
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("an exercise's sheet", () => {
  it("a used-in card opens that session's preview", async () => {
    await i18n.changeLanguage("fr");
    const router = renderRoute("/exercises/ds:0025");
    const used = await screen.findByRole("link", { name: /^Séance A · Push/ });
    expect(used.getAttribute("href")).toBe("/workouts/session/A");
    fireEvent.click(used);
    expect(await screen.findByRole("heading", { name: "Séance A · Push", level: 1 })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/workouts/session/A");
    // The preview's own back chevron, not the tab of the same name in the bar.
    await waitFor(() => {
      const back = screen
        .getAllByRole("link", { name: "Programme" })
        .find((a) => a.closest("nav") === null);
      expect(back?.getAttribute("href")).toBe("/workouts?tab=program");
    });
  });

  it("an exercise with a loop shows it above the body map", async () => {
    fakeApi({ me: { ...ADA, media: true } });
    writeMedia("on");
    renderRoute("/exercises/ds:0025");
    const map = await screen.findByRole("img", { name: /Chest/ });
    const video = document.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("/media/exercises/0025#t=0.001");
    fireEvent(video, new Event("loadeddata"));
    const loop = screen.getByRole("figure", { name: "Demonstration of Barbell bench press" });
    // The loop's card comes right under the header, before the body map's card.
    expect(loop.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.compareDocumentPosition(loop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the next exercise's loop waits for its own first frame on a reused route", async () => {
    fakeApi({ me: { ...ADA, media: true } });
    writeMedia("on");
    const router = renderRoute("/exercises/ds:0025");
    await screen.findByRole("img", { name: /Chest/ });
    fireEvent(document.querySelector("video")!, new Event("loadeddata"));
    expect(
      screen.getByRole("figure", { name: "Demonstration of Barbell bench press" }),
    ).toBeTruthy();

    await act(() =>
      router.navigate({ to: "/exercises/$exerciseId", params: { exerciseId: "ds:0405" } }),
    );
    await screen.findByRole("heading", { level: 1, name: "Dumbbell seated shoulder press" });
    await waitFor(() =>
      expect(document.querySelector("video")!.getAttribute("src")).toBe(
        "/media/exercises/0405#t=0.001",
      ),
    );
    // The previous loop's first frame does not count for this one.
    expect(screen.queryByRole("figure", { name: /^Demonstration/ })).toBeNull();
  });

  it("a belay: exercise and an instance without loops show no loop and no extra text", async () => {
    fakeApi({ me: { ...ADA, media: true } });
    writeMedia("on");
    renderRoute("/exercises/belay:barbell-hip-thrust");
    await screen.findByRole("img", { name: /Glutes/ });
    expect(document.querySelector("video, figure[aria-label]")).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Play the demonstration|Pause)$/ })).toBeNull();
    cleanup();

    fakeApi({ me: ADA });
    writeMedia("off");
    renderRoute("/exercises/ds:0025");
    await screen.findByRole("img", { name: /Chest/ });
    expect(document.querySelector("video, figure[aria-label]")).toBeNull();
    expect(screen.queryByText(/Demonstration|^Play the demonstration$|^Pause$/)).toBeNull();
  });
});

describe("where the program uses an exercise", () => {
  const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${String(n).padStart(2, "0")}`;
  const AT = "2026-10-01T08:00:00.000Z";
  const session = (
    n: number,
    name: string,
    programId: string | null,
    position: number,
  ): Change => ({
    kind: "programSession",
    id: id(n),
    field: "create",
    name,
    programId,
    position,
    at: AT,
  });
  // The bench press, 3 × 5, in session n.
  const bench = (n: number, sessionId: number): Change => ({
    kind: "programSlot",
    id: id(n),
    field: "create",
    sessionId: id(sessionId),
    position: 0,
    rule: null,
    exerciseId: "ds:0025",
    sets: 3,
    repRange: [5, 5],
    rirTarget: [1, 2],
    restSec: 180,
    warmupSets: 2,
    isMain: true,
    groupKey: null,
    at: AT,
  });
  const STRENGTH = id(1);

  it("« utilisé dans » lists the live sessions of the active rotation and of the collection by name", async () => {
    // A device that has synced before.
    const db = await openAccountDb(ADA.id);
    await db.put("meta", "1", "cursor");
    db.close();
    await seed(ADA.id, [
      session(10, "Upper", SEED_PROGRAM_ID, 3), // the rotation's fourth session, D
      bench(11, 10),
      session(20, "Home bench", null, 0), // set aside
      bench(21, 20),
      session(30, "Old bench", null, 1), // set aside, then removed
      bench(31, 30),
      { kind: "programSession", id: id(30), field: "removed", value: true, at: AT },
      // A program that is not the active one.
      {
        kind: "program",
        id: STRENGTH,
        field: "create",
        name: "Strength",
        schedule: DEFAULT_SCHEDULE,
        at: AT,
      },
      session(40, "Heavy", STRENGTH, 0),
      bench(41, 40),
    ]);
    renderRoute("/exercises/ds:0025");
    const home = await screen.findByText("Home bench");
    const rotation = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/workouts/session/"));
    expect(rotation.map((a) => a.getAttribute("href"))).toEqual([
      "/workouts/session/A",
      "/workouts/session/D",
    ]);
    expect(rotation[1]!.textContent).toMatch(/^Session D/);
    expect(rotation[1]!.textContent).toContain("3\u00a0×\u00a05");
    // A set-aside session has no letter, so no preview to open: its name, its targets.
    expect(home.closest("a")).toBeNull();
    expect(home.parentElement!.textContent).toContain("3\u00a0×\u00a05");
    expect(screen.queryByText("Old bench")).toBeNull();
    expect(screen.queryByText("Heavy")).toBeNull();
  });
});
