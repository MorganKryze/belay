import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Languages } from "lucide-react";
import { type ReactNode, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { expectTokensOnly } from "@/test/design-rules";
import { MenuRow } from "./menu-row";

// Radix Select calls pointer-capture and scrolling APIs jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(cleanup);

const OPTIONS = [
  { value: "en", label: "English", lang: "en" },
  { value: "fr", label: "Français", lang: "fr" },
] as const;

function Language({ onChange = () => {} }: { onChange?: (v: "en" | "fr") => void }) {
  const [value, setValue] = useState<"en" | "fr">("en");
  return (
    <MenuRow
      icon={Languages}
      label="Language"
      value={value}
      options={OPTIONS}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

// The app mounts in #root, which the row marks while its menu is open.
function renderInRoot(ui: ReactNode) {
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  const result = render(ui, { container: root });
  return { ...result, root };
}

const row = () => screen.getByRole("combobox", { name: /^Language/ });
const open = () => {
  act(() => row().focus());
  fireEvent.keyDown(row(), { key: "Enter" });
};

describe("MenuRow", () => {
  afterEach(() => document.getElementById("root")?.remove());

  it("names the row by its label then its value, a dot between them, and announces a menu", () => {
    renderInRoot(<Language />);
    const trigger = screen.getByRole("combobox", { name: "Language · English" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.querySelector("[data-slot=row-chevron]")).not.toBeNull();
  });

  it("opens the options with the current one ticked, and a choice calls onChange and closes the menu", () => {
    const onChange = vi.fn();
    renderInRoot(<Language onChange={onChange} />);
    open();
    expect(screen.getByRole("listbox")).toBeTruthy();
    const english = screen.getByRole("option", { name: "English" });
    expect(english.getAttribute("data-state")).toBe("checked");
    expect(english.querySelector("svg")).not.toBeNull();
    const french = screen.getByRole("option", { name: "Français" });
    expect(french.getAttribute("lang")).toBe("fr");
    fireEvent.click(french);
    expect(onChange).toHaveBeenCalledWith("fr");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Language · Français" })).toBeTruthy();
  });

  it("keeps the page out of reach while open and gives it back before the focus returns", () => {
    const { root } = renderInRoot(<Language />);
    let inertWhenFocused: boolean | null = null;
    row().addEventListener("focus", () => (inertWhenFocused = root.hasAttribute("inert")));
    open();
    expect(root.hasAttribute("inert")).toBe(true);
    fireEvent.click(screen.getByRole("option", { name: "Français" }));
    expect(root.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(row());
    expect(inertWhenFocused).toBe(false);
  });

  it("Escape closes it and focuses the row", () => {
    const { root } = renderInRoot(<Language />);
    open();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(root.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(row());
  });

  it("frees the page when unmounted open", () => {
    const { root, unmount } = renderInRoot(<Language />);
    open();
    expect(root.hasAttribute("inert")).toBe(true);
    unmount();
    expect(root.hasAttribute("inert")).toBe(false);
  });

  it("uses tokens only", () => {
    expectTokensOnly("components/menu-row.tsx");
  });
});
