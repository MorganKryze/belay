import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePresence } from "./presence";

afterEach(() => vi.useRealTimers());

const setup = (exitMs?: number) =>
  renderHook(({ value }: { value: string | null }) => usePresence(value, exitMs), {
    initialProps: { value: "a" as string | null },
  });

describe("usePresence", () => {
  it("keeps the last value while it leaves and drops it when the animation ends", () => {
    const { result, rerender } = setup();
    expect(result.current).toMatchObject({ shown: "a", leaving: false });
    rerender({ value: null });
    expect(result.current).toMatchObject({ shown: "a", leaving: true });
    act(() => result.current.onAnimationEnd());
    expect(result.current).toMatchObject({ shown: null, leaving: false });
  });

  it("drops it after exitMs when no animation ends", () => {
    vi.useFakeTimers();
    const { result, rerender } = setup(300);
    rerender({ value: null });
    act(() => vi.advanceTimersByTime(299));
    expect(result.current.shown).toBe("a");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toMatchObject({ shown: null, leaving: false });
  });

  it("a new value during the exit cancels the exit", () => {
    vi.useFakeTimers();
    const { result, rerender } = setup();
    rerender({ value: null });
    rerender({ value: "b" });
    expect(result.current).toMatchObject({ shown: "b", leaving: false });
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.onAnimationEnd());
    expect(result.current.shown).toBe("b");
  });
});
