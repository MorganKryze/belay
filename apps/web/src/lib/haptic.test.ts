import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook is module state, as the platform's session is: fresh modules for each case.
const load = () => import("./haptic");
const vibrate = vi.fn<(pattern: number) => boolean>();

beforeEach(() => {
  vi.resetModules();
  vibrate.mockReset();
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
});
afterEach(() => {
  Reflect.deleteProperty(navigator, "vibrate");
});

describe("haptic", () => {
  it("does nothing until the app sets one, and never reaches for the browser's vibration", async () => {
    const { haptic } = await load();
    expect(() => haptic("success")).not.toThrow();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("hands the kind to the one set", async () => {
    const { haptic, setHaptics } = await load();
    const fire = vi.fn();
    setHaptics(fire);
    haptic("selection");
    haptic("light");
    expect(fire.mock.calls).toEqual([["selection"], ["light"]]);
    expect(vibrate).not.toHaveBeenCalled();
  });
});
