import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { writeMedia } from "../lib/media-flag";
import { renderRoute } from "../test/render-route";
import { ADA } from "../test/seed";

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
