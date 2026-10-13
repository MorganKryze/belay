import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Plus } from "lucide-react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectTokensOnly, sourceFiles } from "@/test/design-rules";
import { Button } from "./ui/button";

afterEach(cleanup);

const classes = (el: HTMLElement) => el.className.split(/\s+/);

describe("Button", () => {
  it("draws primary 50 px radius 14, secondary 44 px radius 12 on the track, text and destructive 44 px", () => {
    render(
      <>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="text">Text</Button>
        <Button variant="destructive">Delete</Button>
        <Button size="icon" aria-label="Add">
          <Plus />
        </Button>
      </>,
    );
    const primary = classes(screen.getByRole("button", { name: "Primary" }));
    expect(primary).toEqual(
      expect.arrayContaining(["bg-primary", "h-12.5", "rounded-field", "text-button"]),
    );
    const secondary = classes(screen.getByRole("button", { name: "Secondary" }));
    expect(secondary).toEqual(
      expect.arrayContaining(["bg-track", "text-foreground", "h-11", "rounded-control"]),
    );
    expect(secondary).not.toContain("h-12.5");
    const text = classes(screen.getByRole("button", { name: "Text" }));
    expect(text).toEqual(expect.arrayContaining(["text-primary", "dark:text-primary-ink", "h-11"]));
    const destructive = classes(screen.getByRole("button", { name: "Delete" }));
    expect(destructive).toEqual(expect.arrayContaining(["text-destructive", "h-11"]));
    expect(classes(screen.getByRole("button", { name: "Add" }))).toContain("size-11");
  });

  it("shows a disabled button as track fill and muted text, never faded", () => {
    render(
      <>
        <Button disabled>Primary</Button>
        <Button variant="text" disabled>
          Text
        </Button>
      </>,
    );
    const primary = screen.getByRole("button", { name: "Primary" }).className;
    expect(primary).toContain("disabled:bg-track");
    expect(primary).toContain("disabled:text-muted-foreground");
    expect(primary).not.toMatch(/opacity/);
    const text = screen.getByRole("button", { name: "Text" }).className;
    expect(text).toContain("disabled:bg-transparent");
    expect(text).toContain("disabled:text-muted-foreground");
    expect(text).not.toMatch(/opacity/);
  });

  it("a busy button keeps its label, swaps its icon for the arc and says it is busy", () => {
    render(
      <Button busy>
        <Plus data-testid="icon" />
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    // The icon keeps its room in the row, unseen, so the width does not move.
    expect(button.className).toContain("aria-busy:[&_svg]:invisible");
    expect(button.className).not.toMatch(/_svg\]:hidden/);
    expect(screen.getByTestId("icon").parentElement?.textContent).toBe("Save");
    const arc = button.querySelector("span.animate-spin-arc");
    expect(arc).not.toBeNull();
    expect(arc?.getAttribute("aria-hidden")).toBe("true");
    expect(classes(arc as HTMLElement)).toEqual(
      expect.arrayContaining([
        "size-4.5",
        "border-current",
        "border-t-transparent",
        "rounded-round",
        // Out of the flow, drawn over the leading icon's slot.
        "absolute",
        "group-has-[>svg:first-child]/busy:-left-px",
      ]),
    );
  });

  it("a busy button without an icon keeps its width: the arc adds nothing to the row", () => {
    render(<Button busy>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    const arc = button.querySelector("span.animate-spin-arc") as HTMLElement;
    expect(arc).not.toBeNull();
    // Absolute and beside the label, in the gap before it, like the board's busy button.
    expect(classes(arc)).toEqual(expect.arrayContaining(["absolute", "right-full", "mr-1.5"]));
    expect(classes(arc)).not.toContain("shrink-0");
    expect(button.textContent).toBe("Save");
  });

  it("a busy button ignores a second tap", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    rerender(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("rings the focused button 2 px offset 2 px", () => {
    render(<Button variant="secondary">Go</Button>);
    expect(classes(screen.getByRole("button", { name: "Go" }))).toEqual(
      expect.arrayContaining([
        "focus-visible:outline-2",
        "focus-visible:outline-offset-2",
        "focus-visible:outline-ring",
      ]),
    );
  });

  it("presses with the shared scale; a text button turns primary-ink on the tint", () => {
    render(
      <>
        <Button>Primary</Button>
        <Button variant="text">Text</Button>
      </>,
    );
    expect(classes(screen.getByRole("button", { name: "Primary" }))).toContain("press");
    expect(classes(screen.getByRole("button", { name: "Text" }))).toEqual(
      expect.arrayContaining(["press", "active:bg-press-tint", "active:text-primary-ink"]),
    );
  });

  it("no call site uses the outline, ghost or link variant any more", () => {
    const found = sourceFiles().flatMap((file) =>
      [
        ...readFileSync(file, "utf8").matchAll(
          /variant=(?:"|{[^}]*")(?:outline|ghost|link|default)"|<Button[^>]*\bsize="(?:lg|sm|xs|icon-\w+)"/g,
        ),
      ].map((m) => `${file}: ${m[0]}`),
    );
    expect(found).toEqual([]);
  });

  it("uses only the charter's tokens", () => {
    expectTokensOnly("components/ui/button.tsx");
  });
});
