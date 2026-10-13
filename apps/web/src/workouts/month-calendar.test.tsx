import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import "../i18n/lazy";
import { expectTokensOnly } from "@/test/design-rules";
import { MonthCalendar } from "./month-calendar";

// Wednesday 7 October 2026 on the phone's clock.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 9, 0));
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function show({
  marked = [] as string[],
  circled = [] as string[],
}: { marked?: string[]; circled?: string[] } = {}) {
  render(
    <MonthCalendar
      month="2026-10"
      current="2026-10"
      marked={new Set(marked)}
      circled={new Set(circled)}
      onMonth={() => {}}
    />,
  );
}

const day = (n: number) =>
  screen
    .getByRole("table")
    .querySelector<HTMLElement>(`[data-day="2026-10-${String(n).padStart(2, "0")}"]`)!;

describe("MonthCalendar", () => {
  it("uses tokens only", () => {
    expectTokensOnly("workouts/month-calendar.tsx");
  });

  it("a session day is a solid primary disc with a light number", () => {
    show({ marked: ["2026-10-05"] });
    const cell = day(5);
    expect(cell.className).toContain("bg-primary");
    expect(cell.className).toContain("text-primary-foreground");
    expect(cell.className).not.toContain("bg-primary-soft");
  });

  it("today is a ring, never a fill", () => {
    show();
    const cell = day(7);
    expect(cell.className).toMatch(/\bring-2\b/);
    expect(cell.className).toMatch(/\bring-foreground\b/);
    expect(cell.className).not.toMatch(/\bbg-/);
  });

  it("today with a session gets the disc and an outer ring", () => {
    show({ marked: ["2026-10-07"] });
    const cell = day(7);
    expect(cell.className).toMatch(/\bbg-primary\b/);
    expect(cell.className).toMatch(/\boutline-2\b/);
    expect(cell.className).toMatch(/\boutline-offset-2\b/);
    expect(cell.className).toMatch(/\boutline-foreground\b/);
  });

  it("an activity day gets a 5 px dot under the number", () => {
    show({ circled: ["2026-10-03"] });
    const dot = day(3).querySelector("[data-dot]")!;
    expect(dot.className).toMatch(/\bsize-1\.25\b/);
    expect(dot.className).toMatch(/\bbg-primary-ink\b/);
    expect(day(3).className).not.toMatch(/\bbg-primary\b/);
  });

  it("a day with both gets a light dot inside the disc", () => {
    show({ marked: ["2026-10-02"], circled: ["2026-10-02"] });
    const dot = day(2).querySelector("[data-dot]")!;
    expect(dot.className).toMatch(/\bbg-primary-foreground\b/);
    expect(day(2).className).toMatch(/\bbg-primary\b/);
  });

  it("a legend names session, activity and today in words", () => {
    show();
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["session", "activity", "today"]);
    cleanup();
    void i18n.changeLanguage("fr");
    show();
    const fr = screen.getByRole("list", { name: "Légende" });
    expect(
      within(fr)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["séance", "activité", "aujourd'hui"]);
  });

  it("sizes the grid and the legend with the secondary type step, never the secondary colour", () => {
    show();
    // `text-secondary` resolves to the track colour, since the colour token wins the name.
    const legend = screen.getByRole("list", { name: "Legend" });
    for (const el of [screen.getByRole("table"), legend]) {
      expect(el.className).toMatch(/\btext-\(length:--text-secondary\)/);
      expect(el.className).toMatch(/\bleading-\(--text-secondary--line-height\)/);
      expect(el.className.split(/\s+/)).not.toContain("text-secondary");
    }
    expect(legend.className).toMatch(/\btext-muted-foreground\b/);
  });

  it("cells are 44 × 44", () => {
    show({ marked: ["2026-10-05"] });
    for (const n of [1, 5, 7, 31]) expect(day(n).className).toMatch(/\bsize-11\b/);
  });

  it("screen readers hear each day's marks, today included", () => {
    show({ marked: ["2026-10-07", "2026-10-02"], circled: ["2026-10-02"] });
    expect(day(7).textContent).toBe("7, session, today");
    expect(day(2).textContent).toBe("2, session, activity");
    expect(day(4).textContent).toBe("4");
  });
});
