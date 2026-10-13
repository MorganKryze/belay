import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { expectTokensOnly } from "@/test/design-rules";
import { Segmented, type SegmentedOptions } from "./segmented";

afterEach(cleanup);

const options: SegmentedOptions<"w" | "m" | "y"> = [
  { value: "w", label: "Week" },
  { value: "m", label: "Month" },
  { value: "y", label: "Year" },
];

function Harness({ initial }: { initial: "w" | "m" | "y" | null }) {
  const [value, setValue] = useState(initial);
  return <Segmented label="Period" value={value} options={options} onChange={setValue} />;
}

const thumb = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-slot=segmented-thumb]");

describe("Segmented", () => {
  it("shows no thumb when nothing is chosen", () => {
    const { container } = render(<Harness initial={null} />);
    expect(thumb(container)).toBeNull();
  });

  it("places the thumb at the chosen option's index and slides it on the nav curve", () => {
    const { container } = render(<Harness initial="m" />);
    const el = thumb(container)!;
    expect(el).not.toBeNull();
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.style.getPropertyValue("--seg-i")).toBe("1");
    const cls = el.className.split(/\s+/);
    expect(cls).toEqual(
      expect.arrayContaining([
        "bg-surface",
        "transition-transform",
        "duration-(--slide-duration)",
        "ease-nav",
      ]),
    );
    expect(el.className).toContain("translate-x-[calc(var(--seg-i)*");
    fireEvent.click(screen.getByRole("radio", { name: "Year" }));
    expect(thumb(container)!.style.getPropertyValue("--seg-i")).toBe("2");
  });

  it("weights the chosen label 700 and the others 600", () => {
    render(<Harness initial="w" />);
    const chosen = screen.getByRole("radio", { name: "Week" }).className;
    const other = screen.getByRole("radio", { name: "Month" }).className;
    expect(chosen).toMatch(/\bfont-bold\b/);
    expect(chosen).toMatch(/\btext-foreground\b/);
    expect(other).toMatch(/\bfont-semibold\b/);
    expect(other).toMatch(/\btext-muted-foreground\b/);
    expect(other).not.toMatch(/\bfont-bold\b/);
  });

  it("moves the choice with the arrow keys", async () => {
    const { container } = render(<Harness initial="w" />);
    const week = screen.getByRole("radio", { name: "Week" });
    week.focus();
    fireEvent.keyDown(week, { key: "ArrowRight" });
    // Radix moves focus on the next tick, and the focus picks the option.
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Month" }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
    expect(thumb(container)!.style.getPropertyValue("--seg-i")).toBe("1");
  });

  it("rings the whole group on keyboard focus", () => {
    render(<Harness initial="w" />);
    const group = screen.getByRole("radiogroup").className;
    // Marked important, as the group's inline `outline: none` would win otherwise; the rendered
    // ring is checked end to end.
    expect(group).toMatch(/has-\[:focus-visible\]:outline-2!/);
    expect(group).toMatch(/has-\[:focus-visible\]:outline-ring!/);
    for (const radio of screen.getAllByRole("radio"))
      expect(radio.className).toMatch(/\bfocus-visible:outline-none\b/);
  });

  it("sizes its text with the secondary type step, never the secondary colour", () => {
    render(<Harness initial="w" />);
    // `text-secondary` resolves to the track colour, since the colour token wins the name.
    const label = screen.getByText("Period").className;
    for (const cls of [label, ...screen.getAllByRole("radio").map((r) => r.className)]) {
      expect(cls).toMatch(/\btext-\(length:--text-secondary\)/);
      expect(cls.split(/\s+/)).not.toContain("text-secondary");
    }
  });

  it("uses tokens only", () => {
    expectTokensOnly("components/segmented.tsx");
  });
});
