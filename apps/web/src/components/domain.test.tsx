import { cleanup, render, screen } from "@testing-library/react";
import { Dumbbell, Scale } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { expectTokensOnly } from "@/test/design-rules";
import { DomainChip, DomainTile } from "./domain";

afterEach(cleanup);

describe("DomainChip", () => {
  it("is a span on its domain's tint, with its words and its icon, never focusable", () => {
    render(
      <DomainChip domain="session" icon={Dumbbell}>
        Next up
      </DomainChip>,
    );
    const chip = screen.getByText("Next up").closest("[data-accent]")!;
    expect(chip.tagName).toBe("SPAN");
    expect(chip.getAttribute("data-accent")).toBe("session");
    expect(chip.hasAttribute("tabindex")).toBe(false);
    expect(chip.className).toMatch(/\bbg-session-tint\b/);
    expect(chip.className).toMatch(/\btext-session-shade\b/);
    const icon = chip.querySelector("svg")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(chip.textContent).toBe("Next up");
    expectTokensOnly("components/domain.tsx");
  });
});

describe("DomainTile", () => {
  it("draws its icon on its domain's tint, hidden from assistive tech", () => {
    const { container } = render(<DomainTile domain="body" icon={Scale} />);
    const tile = container.firstElementChild!;
    expect(tile.getAttribute("aria-hidden")).toBe("true");
    expect(tile.getAttribute("data-accent")).toBe("body");
    expect(tile.className).toMatch(/\bbg-body-tint\b/);
    expect(tile.className).toMatch(/\btext-body-shade\b/);
    expect(tile.querySelector("svg")).not.toBeNull();
  });
});
