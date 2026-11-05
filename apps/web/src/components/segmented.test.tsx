import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setHaptics } from "@/lib/haptic";
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
  it("choosing another segment gives a selection haptic, before the choice is passed on", () => {
    const events: string[] = [];
    setHaptics((kind) => events.push(kind));
    const onChange = vi.fn(() => events.push("change"));
    render(<Segmented label="Period" value="w" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Month" }));
    expect(events).toEqual(["selection", "change"]);
    setHaptics(() => {});
  });

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

  describe("at text sizes where a word outgrows its column", () => {
    // jsdom lays nothing out: the groove's width and each label's width are set by hand, and the
    // observer is told when they change.
    let groove = 0;
    let word = 0;
    let resized: (() => void) | undefined;
    // What the live observer watches: a label it does not watch can grow unseen.
    const watched = new Set<Element>();
    beforeEach(() => {
      watched.clear();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: ResizeObserverCallback) {
            resized = () => callback([], this as unknown as ResizeObserver);
          }
          observe(target: Element) {
            watched.add(target);
          }
          disconnect() {
            watched.clear();
          }
        },
      );
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.getAttribute("role") === "radiogroup" ? groove : 0;
      });
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.dataset.slot === "segmented-label" ? word : 0;
      });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    // A 300 px groove leaves each of three options 88 px for its label.
    it("keeps the options side by side while every label fits", () => {
      groove = 300;
      word = 88;
      const { container } = render(<Harness initial="m" />);
      const group = screen.getByRole("radiogroup");
      expect(group.hasAttribute("data-stacked")).toBe(false);
      expect(group.getAttribute("aria-orientation")).toBe("horizontal");
      expect(thumb(container)!.className).toContain("translate-x-[calc(var(--seg-i)*");
    });

    it("stacks them one per row, arrows going up and down, when a label is wider", () => {
      groove = 300;
      word = 89;
      const { container } = render(<Harness initial="m" />);
      const group = screen.getByRole("radiogroup");
      expect(group.hasAttribute("data-stacked")).toBe(true);
      expect(group.getAttribute("aria-orientation")).toBe("vertical");
      expect(thumb(container)!.className).toContain("translate-y-[calc(var(--seg-i)*");
      expect(thumb(container)!.className).not.toContain("translate-x-");
    });

    // Measuring lays the page out once: a thumb drawn side by side then would slide across to its
    // row as the screen opens.
    it("places the thumb in the stack from its first frame, without sliding there", () => {
      groove = 300;
      word = 151;
      const changes = new MutationObserver(() => {});
      changes.observe(document.body, { subtree: true, attributes: true, attributeOldValue: true });
      const { container } = render(<Harness initial="y" />);
      const before = changes
        .takeRecords()
        .filter((r) => r.target === thumb(container) && r.attributeName === "class")
        .map((r) => r.oldValue);
      changes.disconnect();
      expect(before).toEqual([]);
      expect(thumb(container)!.className).toContain("translate-y-[calc(var(--seg-i)*");
    });

    it("restacks when the text grows after the first layout, and unstacks when it shrinks", () => {
      groove = 300;
      word = 60;
      render(<Harness initial="w" />);
      const group = screen.getByRole("radiogroup");
      expect(group.hasAttribute("data-stacked")).toBe(false);
      word = 151;
      act(() => resized!());
      expect(group.hasAttribute("data-stacked")).toBe(true);
      word = 60;
      act(() => resized!());
      expect(group.hasAttribute("data-stacked")).toBe(false);
    });

    // The same number of options with other values renders new labels: the old ones leave the page.
    it("watches the new labels when the options change for others of the same number", () => {
      groove = 300;
      word = 60;
      const labels = () => [
        ...document.querySelectorAll<HTMLElement>("[data-slot=segmented-label]"),
      ];
      const { rerender } = render(
        <Segmented<string> label="Period" value="w" options={options} onChange={() => {}} />,
      );
      expect(labels().every((label) => watched.has(label))).toBe(true);
      const others: SegmentedOptions<"a" | "b" | "c"> = [
        { value: "a", label: "Day" },
        { value: "b", label: "Quarter" },
        { value: "c", label: "All" },
      ];
      rerender(<Segmented<string> label="Period" value="a" options={others} onChange={() => {}} />);
      expect(labels().map((label) => label.textContent)).toEqual(["Day", "Quarter", "All"]);
      expect(labels().every((label) => watched.has(label))).toBe(true);
      word = 151;
      act(() => resized!());
      expect(screen.getByRole("radiogroup").hasAttribute("data-stacked")).toBe(true);
    });
  });

  it("uses tokens only", () => {
    expectTokensOnly("components/segmented.tsx");
  });
});
