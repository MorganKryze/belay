import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectTokensOnly } from "@/test/design-rules";
import { DayChip } from "./day-chip";

afterEach(cleanup);

describe("DayChip", () => {
  it("draws the chip on the track at 44 px and keeps the native picker", () => {
    render(<DayChip date="2026-10-12" today="2026-10-13" onChange={() => {}} label="Day" />);
    const input = screen.getByLabelText("Day") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.max).toBe("2026-10-13");
    const chip = input.closest("label")!;
    const classes = chip.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["bg-track", "rounded-control", "min-h-11"]));
    expect(classes.some((c) => c === "border" || c.startsWith("border-"))).toBe(false);
    expect(chip.querySelector("svg")!.getAttribute("class")).toContain("size-4");
    expectTokensOnly("components/day-chip.tsx");
  });
});
