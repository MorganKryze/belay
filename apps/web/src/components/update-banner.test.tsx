import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { startUpdates } from "../lib/update";
import { UpdateBanner } from "./update-banner";

const reg = vi.hoisted(() => ({
  updateSW: vi.fn(),
  options: {} as {
    onNeedRefresh?: () => void;
    onRegisteredSW?: (url: string, registration?: ServiceWorkerRegistration) => void;
  },
}));
vi.mock("virtual:pwa-register", () => ({
  registerSW: (options: typeof reg.options) => {
    reg.options = options;
    return reg.updateSW;
  },
}));

beforeEach(() => {
  reg.updateSW.mockReset();
  // Starting afresh forgets a waiting version, so the tests do not depend on their order.
  startUpdates();
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

describe("UpdateBanner", () => {
  it("is a live region that says nothing until a new version waits", () => {
    render(<UpdateBanner />);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the reload once a new version waits, and reloads only on a tap", () => {
    render(<UpdateBanner />);
    act(() => reg.options.onNeedRefresh?.());
    expect(screen.getByText("New version available")).toBeTruthy();
    expect(reg.updateSW).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reg.updateSW).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("the update banner eases down into place", () => {
    render(<UpdateBanner />);
    act(() => reg.options.onNeedRefresh?.());
    const card = screen.getByText("New version available").parentElement!;
    expect(card.classList).toContain("animate-drop-in");
  });

  it("speaks French", async () => {
    await i18n.changeLanguage("fr");
    render(<UpdateBanner />);
    act(() => reg.options.onNeedRefresh?.());
    expect(screen.getByText("Nouvelle version disponible")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recharger" })).toBeTruthy();
  });

  it("schedules the update checks once the worker is registered", () => {
    vi.useFakeTimers();
    const update = vi.fn(() => Promise.resolve());
    reg.options.onRegisteredSW?.("/sw.js", { update } as unknown as ServiceWorkerRegistration);
    vi.advanceTimersByTime(60 * 60 * 1000);
    vi.useRealTimers();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
