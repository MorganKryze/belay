import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectTokensOnly } from "@/test/design-rules";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

// Radix Select calls pointer-capture and scrolling APIs jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(cleanup);

function openMenu() {
  render(
    <Select open defaultValue="dark">
      <SelectTrigger aria-label="Thème" aria-invalid>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="light">Clair</SelectItem>
        <SelectItem value="dark">Sombre</SelectItem>
      </SelectContent>
    </Select>,
  );
}

describe("Select", () => {
  it("anchors the menu on the surface with 44 px rows", () => {
    openMenu();
    const menu = screen.getByRole("listbox");
    const content = menu.closest("[data-slot=select-content]")!;
    for (const c of ["bg-popover", "rounded-field", "p-1", "shadow-float", "dark:border"]) {
      expect(content.className).toContain(c);
    }
    expect(content.getAttribute("data-align-trigger")).toBe("false");
    for (const option of screen.getAllByRole("option")) {
      expect(option.className).toMatch(/\bmin-h-11\b/);
      expect(option.className).toMatch(/\brounded-chip\b/);
      expect(option.className).toMatch(/\btext-body\b/);
    }
  });

  it("ticks the chosen value", () => {
    openMenu();
    const chosen = screen.getByRole("option", { name: "Sombre" });
    expect(chosen.className).toContain("data-[state=checked]:font-semibold");
    const tick = chosen.querySelector("svg")!;
    expect(tick.getAttribute("class")).toMatch(/\bsize-4\b/);
    expect(tick.getAttribute("class")).toMatch(/\btext-primary-ink\b/);
    expect(screen.getByRole("option", { name: "Clair" }).querySelector("svg")).toBeNull();
  });

  it("tints the highlighted row 6 %", () => {
    openMenu();
    expect(screen.getByRole("option", { name: "Clair" }).className).toContain(
      "data-highlighted:bg-(--press-tint)",
    );
  });

  it("never turns red", () => {
    openMenu();
    const trigger = document.querySelector("[data-slot=select-trigger]")!;
    expect(trigger.className).not.toMatch(/destructive/);
  });

  it("uses tokens only", () => {
    expectTokensOnly("components/ui/select.tsx");
  });
});
