import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  it("asks the question as title and says what goes", () => {
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

  it("a busy Supprimer stays readable, without opacity", () => {
    renderSheet({ busy: true });
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    const classes = classesOf(confirm);
    expect(classes.filter((c) => c.includes("opacity"))).toEqual([]);
    expect(classes).toEqual(
      expect.arrayContaining(["disabled:bg-track", "disabled:text-muted-foreground"]),
    );
  });

  it("draws the focus ring inside each row, where the rounded card cannot clip it", () => {
    renderSheet();
    for (const name of ["Delete", "Cancel"]) {
      const button = screen.getByRole("button", { name });
      expect(classesOf(button)).toEqual(
        expect.arrayContaining([
          "focus-visible:outline-2",
          "focus-visible:-outline-offset-2",
          "first:rounded-t-group",
          "last:rounded-b-group",
        ]),
      );
    }
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

  it("a primary row sits above the red one and runs its action", () => {
    vi.spyOn(motion, "exitWillAnimate").mockReturnValue(false);
    const onSelect = vi.fn();
    const { onConfirm, onClose } = renderSheet({
      primary: { label: "Finish and save", onSelect },
      confirm: "Delete the session…",
    });
    const primary = screen.getByRole("button", { name: "Finish and save" });
    const red = screen.getByRole("button", { name: "Delete the session…" });
    expect(primary.closest("[data-action-card]")).toBe(red.closest("[data-action-card]"));
    expect(primary.compareDocumentPosition(red) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(classesOf(primary)).toEqual(
      expect.arrayContaining(["text-primary", "font-bold", "min-h-14", "focus-visible:outline-2"]),
    );
    expect(classesOf(primary)).not.toContain("text-destructive");
    fireEvent.click(primary);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the separate row takes the given label", async () => {
    renderSheet({ cancel: "Keep going" });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const keep = screen.getByRole("button", { name: "Keep going" });
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    // Still the first focus: Enter right after opening keeps the session.
    expect(document.activeElement).toBe(keep);
    expect(keep.closest("[data-action-card]")!.contains(screen.getByRole("heading"))).toBe(false);
  });

  it("a three-line body is not cut", () => {
    renderSheet({
      body: "11 sets logged out of 19. The 8 unticked sets won't be saved; your program doesn't change.",
    });
    const body = screen.getByText(/^11 sets logged out of 19\./);
    expect(classesOf(body).filter((c) => c.startsWith("line-clamp"))).toEqual([]);
  });

  it("the sign-out and remove-session sheets read as before", () => {
    renderSheet();
    const card = screen.getByRole("heading").closest("[data-action-card]")!;
    // Title, body, then the one red row: no primary row unless asked for.
    expect(
      within(card as HTMLElement)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Delete"]);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});
