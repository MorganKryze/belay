import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n";
import { RangeList } from "./range-list";

afterEach(cleanup);

const rows = [
  { id: "below", range: "< 18.5", label: "Below" },
  { id: "reference", range: "18.5 – 25", label: "WHO reference range", reference: true },
  { id: "above", range: "25 – 30", label: "Above" },
];

describe("RangeList", () => {
  it("marks the current row and says it to screen readers", () => {
    render(<RangeList label="WHO ranges" rows={rows} currentId="reference" />);
    const list = screen.getByRole("list", { name: "WHO ranges" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("aria-current"))).toEqual([null, "true", null]);
    expect(
      within(items[1]!).getByText("Your value is in this range: 18.5 – 25, WHO reference range."),
    ).toBeTruthy();
    expect(within(items[1]!).getByText("you").getAttribute("aria-hidden")).toBe("true");
  });

  it("marks nothing when there is no current value", () => {
    render(<RangeList label="WHO ranges" rows={rows} currentId={null} />);
    expect(screen.queryByText(/Your value is in this range/)).toBeNull();
  });
});
