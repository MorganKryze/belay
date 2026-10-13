import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { motion } from "@/lib/motion";
import { expectTokensOnly } from "@/test/design-rules";
import { ActionSheet } from "./action-sheet";

beforeAll(() => i18n.changeLanguage("en"));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const classesOf = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

function renderSheet(props: Partial<Parameters<typeof ActionSheet>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ActionSheet
      title="Delete this session?"
      body="Its sets will leave the history."
      confirm="Delete"
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />,
  );
  return { onConfirm, onClose };
}

describe("ActionSheet", () => {
  it("asks the question as title and says what goes in two lines at most", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog", { name: "Delete this session?" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    const title = screen.getByRole("heading", { name: "Delete this session?" });
    expect(classesOf(title)).toEqual(expect.arrayContaining(["text-body", "font-[650]"]));
    const body = screen.getByText("Its sets will leave the history.");
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)).toBe(body);
    expect(classesOf(body)).toEqual(
      expect.arrayContaining([
        "text-(length:--text-secondary)",
        "leading-(--text-secondary--line-height)",
        "text-muted-foreground",
        "line-clamp-2",
      ]),
    );
    expectTokensOnly("components/action-sheet.tsx");
  });

  it("draws Supprimer in red in 56 px rows and a separate bold Annuler", () => {
    renderSheet();
    const confirm = screen.getByRole("button", { name: "Delete" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(classesOf(confirm)).toEqual(expect.arrayContaining(["text-destructive", "min-h-14"]));
    expect(classesOf(cancel)).toEqual(expect.arrayContaining(["font-bold", "min-h-14"]));
    const first = confirm.closest("[data-action-card]")!;
    const second = cancel.closest("[data-action-card]")!;
    expect(first).not.toBe(second);
    expect(first.contains(screen.getByRole("heading"))).toBe(true);
    for (const c of [first, second])
      expect(classesOf(c)).toEqual(expect.arrayContaining(["bg-surface", "rounded-group"]));
  });

  it("Supprimer writes the removal before the sheet leaves", () => {
    vi.spyOn(motion, "exitWillAnimate").mockReturnValue(true);
    const states: (string | null)[] = [];
    const { onClose } = renderSheet({
      onConfirm: () => states.push(screen.getByRole("dialog").getAttribute("data-state")),
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(states).toEqual(["open"]);
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog.getAttribute("data-state")).toBe("closed");
    fireEvent.animationEnd(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Annuler and Escape close it once", async () => {
    for (const close of [
      () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })),
      () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }),
    ]) {
      const { onClose, onConfirm } = renderSheet();
      await act(() => new Promise((r) => setTimeout(r, 0)));
      close();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
      cleanup();
    }
  });
});
