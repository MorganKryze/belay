import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { OpenAccount } from "@/sync/account";
import { expectTokensOnly } from "@/test/design-rules";
import { Toast, type ToastState, useWriter } from "./weigh-in";

const record = vi.fn<(changes: unknown) => Promise<void>>();
vi.mock("@/sync/account", () => ({ useRecord: () => record }));

beforeEach(async () => {
  record.mockReset();
  record.mockResolvedValue(undefined);
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ok: ToastState = { id: 1, text: "Saved", undo: () => Promise.resolve(true) };
const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/);
const card = () => screen.getByRole("status").firstElementChild;

describe("Toast", () => {
  it("draws the toast in inverse colours with a 44 px action in the toast-action colour", () => {
    render(<Toast toast={ok} onDone={() => {}} />);
    expect(classes(card())).toEqual(
      expect.arrayContaining([
        "bg-foreground",
        "text-background",
        "rounded-field",
        "shadow-float",
        "text-body",
      ]),
    );
    const action = screen.getByRole("button", { name: "Undo" });
    expect(classes(action)).toEqual(
      expect.arrayContaining(["min-h-11", "min-w-11", "font-bold", "text-toast-action"]),
    );
  });

  it("an error shows the alert icon, its sentence and a retry action, no red", () => {
    const retry = vi.fn(() => Promise.resolve(true));
    const onDone = vi.fn();
    render(
      <Toast toast={{ id: 2, text: "Could not save", undo: retry, error: true }} onDone={onDone} />,
    );
    expect(screen.getByRole("status").textContent).toContain("Could not save");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    const action = screen.getByRole("button", { name: "Try again" });
    expect(classes(action)).toEqual(
      expect.arrayContaining(["min-h-11", "min-w-11", "font-bold", "text-toast-action"]),
    );
    act(() => action.click());
    expect(retry).toHaveBeenCalledOnce();
    const icon = card()!.querySelector("svg");
    expect(classes(icon)).toContain("text-toast-icon");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(card()!.outerHTML).not.toMatch(/destructive|red-/);
  });

  it("a failed undo turns the toast into the error state and keeps the undo to retry", async () => {
    const { result } = renderHook(() => useWriter({} as OpenAccount));
    await act(() => result.current.write([], [], "Saved"));
    record.mockRejectedValueOnce(new Error("lost"));
    await act(async () => {
      expect(await result.current.toast!.undo!()).toBe(false);
    });
    expect(result.current.toast?.error).toBe(true);
    await act(async () => {
      expect(await result.current.toast!.undo!()).toBe(true);
    });
  });

  it("goes after 5 s", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWriter({} as OpenAccount));
    await act(() => result.current.write([], [], "Saved"));
    expect(result.current.toast?.text).toBe("Saved");
    act(() => vi.advanceTimersByTime(4999));
    expect(result.current.toast).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.toast).toBeNull();
  });

  it("a long text takes the full width and puts the action below it on the right", () => {
    render(<Toast toast={ok} onDone={() => {}} />);
    expect(classes(card())).toEqual(expect.arrayContaining(["flex", "flex-wrap", "justify-end"]));
    const group = screen.getByText("Saved").parentElement;
    expect(group?.parentElement).toBe(card());
    expect(classes(group)).toEqual(expect.arrayContaining(["flex", "min-w-0", "grow"]));
  });

  it("keeps the alert icon beside a long error, only the action wraps", () => {
    const text = "Couldn't save on this phone, the storage is full. Try again.";
    render(<Toast toast={{ id: 3, text, error: true }} onDone={() => {}} />);
    const sentence = screen.getByText(text);
    const icon = card()!.querySelector("svg");
    expect(icon?.parentElement).toBe(sentence.parentElement);
    expect(sentence.parentElement?.parentElement).toBe(card());
    expect(classes(sentence.parentElement)).toEqual(
      expect.arrayContaining(["flex", "min-w-0", "grow", "items-start"]),
    );
  });

  it("rises in, then fades out while it leaves", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Toast toast={ok} onDone={() => {}} />);
    expect(classes(card())).toContain("animate-rise-in");
    rerender(<Toast toast={null} onDone={() => {}} />);
    expect(classes(card())).toContain("animate-fade-out");
    expect(screen.getByText("Saved")).not.toBeNull();
    act(() => vi.advanceTimersByTime(400));
    expect(card()).toBeNull();
  });

  it("sits above the chrome on a phone and centred 400 px wide 24 px from the bottom from 1 024 px", () => {
    render(<Toast toast={null} onDone={() => {}} />);
    expect(classes(screen.getByRole("status"))).toEqual(
      expect.arrayContaining([
        "fixed",
        "inset-x-0",
        "mx-auto",
        "bottom-[var(--chrome-bottom,calc(5.5rem+env(safe-area-inset-bottom)))]",
        "lg:bottom-6",
        "lg:w-[400px]",
        "lg:px-0",
      ]),
    );
  });

  it("uses only design tokens", () => {
    expectTokensOnly("components/weigh-in.tsx");
  });
});
