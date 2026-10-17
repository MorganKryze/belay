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
    expect(button.textContent).toBe("Save");
    // The arc leads the row, in the flow, and the icon right after it gives up its room.
    const arc = button.firstElementChild as HTMLElement;
    expect(arc.matches("span.animate-spin-arc[data-slot=busy-arc]")).toBe(true);
    expect(arc.getAttribute("aria-hidden")).toBe("true");
    expect(arc.nextElementSibling).toBe(screen.getByTestId("icon"));
    expect(classes(button)).toContain("[&>[data-slot=busy-arc]+svg]:hidden");
    expect(button.className).not.toMatch(/_svg\]:(?:hidden|invisible)/);
    expect(classes(arc)).toEqual(
      expect.arrayContaining([
        "size-4.5",
        "border-current",
        "border-t-transparent",
        "rounded-round",
        "shrink-0",
        // 18 px drawn in the 16 px of the icon it replaces, so the width does not move.
        "-mx-px",
      ]),
    );
    expect(classes(arc)).not.toContain("absolute");
  });

  it("a busy button with a trailing icon draws the arc before the label, in the icon's room", () => {
    render(
      <Button busy>
        Next
        <Plus data-testid="icon" />
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Next" });
    const arc = button.firstElementChild as HTMLElement;
    expect(arc.dataset.slot).toBe("busy-arc");
    // The sibling selector skips the label's text node: this icon is the one hidden.
    expect(arc.nextElementSibling).toBe(screen.getByTestId("icon"));
  });

  it("a busy button without an icon keeps its width and draws the arc inside, in its padding", () => {
    render(
      <>
        <Button busy>Save</Button>
        <Button variant="secondary" busy>
          Cancel
        </Button>
        <Button variant="text" busy>
          Retry
        </Button>
        <Button variant="destructive" busy>
          Delete
        </Button>
      </>,
    );
    for (const name of ["Save", "Cancel", "Retry", "Delete"]) {
      const button = screen.getByRole("button", { name });
      expect(button.textContent).toBe(name);
      const arc = button.firstElementChild as HTMLElement;
      expect(arc.dataset.slot).toBe("busy-arc");
      expect(classes(arc)).not.toContain("absolute");
    }
    // The arc (16 px in the flow) and its gap take 22 px: 11 px out of each side's padding.
    const room = "aria-busy:not-has-[>[data-slot=busy-arc]+svg]:";
    expect(classes(screen.getByRole("button", { name: "Save" }))).toContain(`${room}px-1.25`);
    for (const name of ["Cancel", "Retry", "Delete"]) {
      expect(classes(screen.getByRole("button", { name }))).toContain(`${room}px-px`);
    }
  });

  it("styles a link as a button, busy or not, without wrapping it", () => {
    render(
      <>
        <Button asChild>
          <a href="/body">Body</a>
        </Button>
        <Button asChild busy>
          <a href="/save">Save</a>
        </Button>
      </>,
    );
    expect(screen.getByRole("link", { name: "Body" }).dataset.slot).toBe("button");
    const busy = screen.getByRole("link", { name: "Save" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.querySelector("[data-slot=busy-arc]")).toBeNull();
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
