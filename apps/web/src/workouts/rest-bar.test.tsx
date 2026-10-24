import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import "../i18n/lazy";
import { restEnded } from "../lib/rest-sound";
import { RestBar } from "./rest-bar";

// The tone itself is the sound module's to test; here, only when the bar asks for it.
vi.mock("../lib/rest-sound", () => ({ restEnded: vi.fn(() => true) }));

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(restEnded).mockClear();
  Reflect.deleteProperty(navigator, "vibrate");
});

const at = (s: number) => new Date(Date.parse("2026-10-05T17:00:00.000Z") + s * 1000).toISOString();
const line = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("span[aria-hidden][style]")!.style.transform;

describe("the rest bar's line", () => {
  it("stands where it was across a pause that stopped the rest", () => {
    // A 90 s rest from 0 s, paused at 30 s for two minutes: 60 s left before and after.
    vi.useFakeTimers({ now: Date.parse(at(150)) });
    const props = { planned: 90_000, next: "Rest", stops: "all" as const, onChange: () => {} };
    const { container, rerender } = render(
      <RestBar {...props} endsAt={at(90)} pausedAt={at(30)} />,
    );
    const before = line(container);
    expect(before).toBe(`scaleX(${60 / 90})`);
    rerender(<RestBar {...props} endsAt={at(210)} pausedAt={null} />);
    expect(line(container)).toBe(before);
  });

  it("stays full after +30 s, then runs down from there", () => {
    vi.useFakeTimers({ now: Date.parse(at(20)) });
    const { container } = render(
      <RestBar
        planned={90_000}
        next="Rest"
        stops="all"
        onChange={() => {}}
        endsAt={at(120)}
        pausedAt={null}
      />,
    );
    expect(line(container)).toBe("scaleX(1)");
  });
});

describe("the rest bar's countdown", () => {
  it("stands still from the tap that paused it, not from the clock's last tick", () => {
    // 150 s of rest from 0 s; the clock last ticked at 0 s and the pause is tapped at 1.2 s.
    vi.useFakeTimers({ now: Date.parse(at(0)) });
    const props = { planned: 150_000, next: "Rest", stops: "all" as const, onChange: () => {} };
    const { rerender } = render(<RestBar {...props} endsAt={at(150)} pausedAt={null} />);
    expect(screen.getByRole("timer").textContent).toBe("2:30");
    vi.setSystemTime(Date.parse(at(1.2)));
    rerender(<RestBar {...props} endsAt={at(150)} pausedAt={at(1.2)} />);
    expect(screen.getByRole("timer").textContent).toBe("2:29");
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("timer").textContent).toBe("2:29");
  });
});

describe("the rest bar's end", () => {
  const props = { planned: 90_000, next: "Rest", stops: "all" as const, pausedAt: null };
  // The session screen around the bar: it keeps the end, and drops the bar once it is null.
  function Host({ endsAt: first }: { endsAt: string }) {
    const [endsAt, setEndsAt] = useState<string | null>(first);
    return endsAt && <RestBar {...props} endsAt={endsAt} onChange={setEndsAt} />;
  }

  it("the rest bar plays the tone when its rest runs out, not when skipped", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    vi.useFakeTimers({ now: Date.parse(at(0)) });
    const { rerender } = render(<RestBar {...props} endsAt={at(2)} onChange={() => {}} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(restEnded).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1500));
    // Beside the vibration and the announcement, which stay as they were.
    expect(restEnded).toHaveBeenCalledExactlyOnceWith(at(2));
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(200);
    expect(screen.getByRole("status").textContent).toBe("Rest over");
    act(() => vi.advanceTimersByTime(2000));
    rerender(<RestBar {...props} endsAt={at(2)} onChange={() => {}} />);
    expect(restEnded).toHaveBeenCalledOnce();
    cleanup();

    // Skip puts the rest away before its end: the bar goes with it and plays nothing.
    vi.mocked(restEnded).mockClear();
    vi.setSystemTime(Date.parse(at(0)));
    render(<Host endsAt={at(4)} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("timer")).toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    cleanup();
    // +30 s moves the end later: nothing at the first end, the tone at the new one.
    vi.setSystemTime(Date.parse(at(0)));
    render(<Host endsAt={at(4)} />);
    fireEvent.click(screen.getByRole("button", { name: "+30 s" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(restEnded).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(25_000));
    expect(restEnded).toHaveBeenCalledExactlyOnceWith(at(34));
  });

  it("a rest frozen by a pause plays nothing", () => {
    // 60 s left when the pause came at 30 s; two minutes later it still holds them.
    vi.useFakeTimers({ now: Date.parse(at(30)) });
    render(<RestBar {...props} pausedAt={at(30)} endsAt={at(90)} onChange={() => {}} />);
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByRole("timer").textContent).toBe("1:00");
    expect(restEnded).not.toHaveBeenCalled();
  });
});
