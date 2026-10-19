import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import "../i18n/lazy";
import { RestBar } from "./rest-bar";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
