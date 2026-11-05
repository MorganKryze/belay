import { beforeEach, describe, expect, it, vi } from "vitest";

const { haptics } = vi.hoisted(() => ({
  haptics: {
    notification: vi.fn<(o: { type: string }) => Promise<void>>(),
    impact: vi.fn<(o: { style: string }) => Promise<void>>(),
    selectionStart: vi.fn<() => Promise<void>>(),
    selectionChanged: vi.fn<() => Promise<void>>(),
    selectionEnd: vi.fn<() => Promise<void>>(),
  },
}));
vi.mock("@capacitor/haptics", () => ({
  Haptics: haptics,
  NotificationType: { Success: "SUCCESS" },
  ImpactStyle: { Light: "LIGHT" },
}));

import { fireHaptic } from "./haptics";

const flush = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(() => {
  for (const fn of Object.values(haptics)) fn.mockReset().mockResolvedValue();
});

describe("fireHaptic", () => {
  it("success is the system's success notification", () => {
    fireHaptic("success");
    expect(haptics.notification).toHaveBeenCalledWith({ type: "SUCCESS" });
  });

  it("light is a light impact", () => {
    fireHaptic("light");
    expect(haptics.impact).toHaveBeenCalledWith({ style: "LIGHT" });
  });

  it("selection starts, changes and ends, in that order", async () => {
    const order: string[] = [];
    haptics.selectionStart.mockImplementation(async () => void order.push("start"));
    haptics.selectionChanged.mockImplementation(async () => void order.push("changed"));
    haptics.selectionEnd.mockImplementation(async () => void order.push("end"));
    const result = fireHaptic("selection");
    // Never awaited: the caller goes on to its write at once.
    expect(result).toBeUndefined();
    await flush();
    expect(order).toEqual(["start", "changed", "end"]);
  });

  it("a refused call changes nothing and raises nothing", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    for (const fn of Object.values(haptics)) fn.mockRejectedValue(new Error("no engine"));
    expect(() => {
      fireHaptic("success");
      fireHaptic("light");
      fireHaptic("selection");
    }).not.toThrow();
    await flush();
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
