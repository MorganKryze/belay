import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { motion } from "@/lib/motion";
import { expectTokensOnly } from "@/test/design-rules";
import { Sheet } from "./sheet";

beforeAll(() => i18n.changeLanguage("en"));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const classesOf = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);
// Radix arms its outside-click listener on the next tick after the sheet mounts.
const tick = () => act(() => new Promise((r) => setTimeout(r, 0)));
const overlay = () => document.querySelector<HTMLElement>("[data-sheet-overlay]")!;

// A page that opens one sheet from a button and drops it when the sheet says it closed.
function Owner({
  onClose,
  open = true,
  dropOpener = false,
}: {
  onClose: () => void;
  open?: boolean;
  dropOpener?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <h1 tabIndex={-1} data-focus-fallback>
        Body
      </h1>
      {!(dropOpener && shown) && (
        <button type="button" onClick={() => setShown(true)}>
          Open
        </button>
      )}
      {shown && (
        <Sheet
          title="Weigh-in"
          open={open}
          onClose={() => {
            onClose();
            setShown(false);
          }}
        >
          <button type="button">Save</button>
        </Sheet>
      )}
    </>
  );
}

function openSheet(props: Parameters<typeof Owner>[0]) {
  const view = render(<Owner {...props} />);
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  return { ...view, opener };
}

describe("Sheet", () => {
  it("puts focus on the title when it opens", () => {
    openSheet({ onClose: () => {} });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Weigh-in" }));
  });

  it("closes from the close button, the overlay and Escape, telling its owner once", async () => {
    for (const close of [
      () => fireEvent.click(screen.getByRole("button", { name: "Close" })),
      () => {
        // A tap on the overlay: Radix waits for the click that ends the press.
        fireEvent.pointerDown(overlay());
        fireEvent.click(overlay());
      },
      () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }),
    ]) {
      const onClose = vi.fn();
      openSheet({ onClose });
      await tick();
      close();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).toBeNull();
      cleanup();
    }
  });

  it("plays the exit before telling its owner", () => {
    vi.spyOn(motion, "exitWillAnimate").mockReturnValue(true);
    const onClose = vi.fn();
    openSheet({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog.getAttribute("data-state")).toBe("closed");
    expect(onClose).not.toHaveBeenCalled();
    // A child's own animation ending is not the sheet's exit.
    fireEvent.animationEnd(screen.getByRole("button", { name: "Save", hidden: true }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.animationEnd(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("closes within 400 ms when the exit never ends", () => {
    vi.useFakeTimers();
    vi.spyOn(motion, "exitWillAnimate").mockReturnValue(true);
    const onClose = vi.fn();
    openSheet({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    act(() => vi.advanceTimersByTime(399));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("reports one close when several requests arrive", () => {
    vi.useFakeTimers();
    vi.spyOn(motion, "exitWillAnimate").mockReturnValue(true);
    const onClose = vi.fn();
    const { rerender } = render(<Sheet title="Weigh-in" onClose={onClose} children={null} />);
    const close = screen.getByRole("button", { name: "Close" });
    fireEvent.click(close);
    fireEvent.click(close);
    fireEvent.keyDown(close, { key: "Escape" });
    rerender(<Sheet title="Weigh-in" open={false} onClose={onClose} children={null} />);
    fireEvent.animationEnd(screen.getByRole("dialog", { hidden: true }));
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an owner's open={false} plays the same exit", () => {
    vi.spyOn(motion, "exitWillAnimate").mockReturnValue(true);
    const onClose = vi.fn();
    const { rerender } = render(<Sheet title="Weigh-in" onClose={onClose} children={null} />);
    rerender(<Sheet title="Weigh-in" open={false} onClose={onClose} children={null} />);
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog.getAttribute("data-state")).toBe("closed");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.animationEnd(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("returns focus to its opener after the exit, or to the page heading when the opener is gone", async () => {
    vi.spyOn(motion, "exitWillAnimate").mockReturnValue(true);
    const { opener } = openSheet({ onClose: () => {} });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await tick();
    expect(document.activeElement).not.toBe(opener);
    fireEvent.animationEnd(screen.getByRole("dialog", { hidden: true }));
    // Radix hands focus back on the tick after the sheet unmounts.
    await tick();
    expect(document.activeElement).toBe(opener);
    cleanup();

    openSheet({ onClose: () => {}, dropOpener: true });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.animationEnd(screen.getByRole("dialog", { hidden: true }));
    await tick();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Body" }));
  });

  it("lays out handle, a 17 px title on two lines at most, the chip and a 44 px close that never shrink", () => {
    render(
      <Sheet title="New annotation" chip={<span>Wed 30 Sep</span>} onClose={() => {}}>
        <button type="button">Add</button>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog");
    const handle = dialog.firstElementChild!;
    expect(handle.getAttribute("aria-hidden")).toBe("true");
    expect(classesOf(handle)).toEqual(expect.arrayContaining(["lg:hidden"]));
    const title = screen.getByRole("heading", { name: "New annotation" });
    expect(classesOf(title)).toEqual(
      expect.arrayContaining(["text-title-compact", "text-foreground", "line-clamp-2", "min-w-0"]),
    );
    const header = title.parentElement!;
    expect(header.previousElementSibling).toBe(handle);
    const chip = screen.getByText("Wed 30 Sep").parentElement!;
    const close = screen.getByRole("button", { name: "Close" });
    expect([...header.children]).toEqual([title, chip, close]);
    expect(classesOf(chip)).toContain("shrink-0");
    expect(classesOf(close)).toEqual(expect.arrayContaining(["size-11", "shrink-0"]));
    // The main button comes right after the header, with no spacer pushing it down.
    expect(header.nextElementSibling).toBe(screen.getByRole("button", { name: "Add" }));
  });

  it("draws the card inset 8 px, radius 30, over the scrim; bordered in dark", () => {
    render(<Sheet title="Weigh-in" onClose={() => {}} children={null} />);
    const card = classesOf(screen.getByRole("dialog"));
    expect(card).toEqual(
      expect.arrayContaining([
        "inset-x-2",
        "bottom-2",
        "rounded-sheet",
        "bg-surface",
        "shadow-sheet",
        "dark:border",
        "dark:border-border",
        "data-[state=open]:animate-sheet-in",
        "data-[state=closed]:animate-sheet-out",
        "lg:w-[480px]",
        "lg:rounded-bar",
        "lg:data-[state=open]:animate-dialog-in",
        "lg:data-[state=closed]:animate-fade-out",
      ]),
    );
    expect(classesOf(overlay())).toEqual(
      expect.arrayContaining([
        "bg-scrim",
        "data-[state=open]:animate-overlay-in",
        "data-[state=closed]:animate-overlay-out",
      ]),
    );
    expectTokensOnly("components/sheet.tsx");
  });
});

describe("motion.exitWillAnimate", () => {
  it("is false without an element, without an animation, or in a hidden tab", () => {
    const el = document.createElement("div");
    document.body.append(el);
    expect(motion.exitWillAnimate(null)).toBe(false);
    expect(motion.exitWillAnimate(el)).toBe(false);
    el.style.animationName = "sheet-out";
    expect(motion.exitWillAnimate(el)).toBe(true);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    expect(motion.exitWillAnimate(el)).toBe(false);
    el.remove();
  });
});
