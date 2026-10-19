import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { History } from "./history";

const TODAY = "2026-10-07";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

// Today weighed with its intake, Sunday a waist alone.
function show(onSelect = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <History
        weighings={[{ date: TODAY, weightKg: 79.8 }]}
        measures={[{ date: "2026-10-04", waistCm: 82, neckCm: null, hipCm: null }]}
        intake={[{ date: TODAY, kcal: 2100, proteinG: null }]}
        today={TODAY}
        onSelect={onSelect}
      />
    </I18nextProvider>,
  );
  return { onSelect, history: screen.getByRole("region", { name: "History" }) };
}

describe("History", () => {
  it("a weighed day ends in a chevron and opens its weigh-in", () => {
    const { onSelect, history } = show();
    const row = within(history).getByRole("button", { name: /^Today/ });
    const last = row.lastElementChild!;
    expect(last.tagName.toLowerCase()).toBe("svg");
    expect(last.getAttribute("aria-hidden")).toBe("true");
    expect(last.getAttribute("class")).toContain("col-start-2");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(TODAY);
  });

  it("a day with no weigh-in reads only and keeps the chevron's room", () => {
    const { history } = show();
    expect(within(history).queryByRole("button", { name: /^Sun, Oct 4/ })).toBeNull();
    const item = within(history).getAllByRole("listitem")[1]!;
    const row = item.firstElementChild as HTMLElement;
    expect(row.tagName.toLowerCase()).toBe("div");
    const spacer = row.lastElementChild!;
    expect(spacer.tagName.toLowerCase()).toBe("span");
    expect(spacer.getAttribute("aria-hidden")).toBe("true");
    expect(spacer.className).toContain("size-4");
    expect(spacer.textContent).toBe("");
  });

  it("the section is one list under its header", () => {
    const { history } = show();
    const heading = within(history).getByRole("heading", { level: 2, name: "History" });
    expect(heading.id).toBe("history");
    const lists = within(history).getAllByRole("list");
    expect(lists).toHaveLength(1);
    expect(heading.nextElementSibling).toBe(lists[0]);
    // The kit's grouped card: its hairlines and surface, proven in a browser by the e2e.
    expect(lists[0]!.className).toContain("divide-y");
    expect(within(lists[0]!).getAllByRole("listitem")).toHaveLength(2);
    expect(history.querySelectorAll("[data-slot=row-icon]")).toHaveLength(0);
  });
});
