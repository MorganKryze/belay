import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { motion } from "../../lib/motion";
import { TOOL_STATE_KEY } from "../../lib/tool-storage";
import { renderRoute } from "../../test/render-route";
import { EnergyInputs } from "./energy";
import { ProjectionInputs } from "./projection";
import { ProteinInputs } from "./protein";

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

const result = (name: string) => screen.findByRole("region", { name });
const type = (label: string, value: string) => {
  const field = screen.getByRole("textbox", { name: label });
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};
const save = (state: object) => localStorage.setItem(TOOL_STATE_KEY, JSON.stringify(state));

describe("page schemas", () => {
  it("every schema parses {} so the storage fallback never throws", () => {
    expect(EnergyInputs.safeParse({}).success).toBe(true);
    expect(ProteinInputs.safeParse({}).success).toBe(true);
    expect(ProjectionInputs.safeParse({}).success).toBe(true);
  });
});

describe("energy", () => {
  // Hidden included: while the sheet is open, the page behind it is out of the accessibility tree.
  const activityRow = () => screen.getByRole("button", { name: /^Your activity/, hidden: true });
  const openSheet = async () => {
    fireEvent.click(activityRow());
    return screen.findByRole("listbox", { name: "Your activity" });
  };

  it("multiplies Mifflin by the chosen FAO level", async () => {
    save({
      formula: "male",
      heightCm: 180,
      weightKg: 80,
      lastInputs: { energy: { ageYears: 30 } },
    });
    renderRoute("/tools/energy");
    const card = await result("Today's expenditure");
    expect(card.textContent).toContain("2,760\u00a0kcal"); // 1780 x 1.55
    expect(card.textContent).toContain("between 2,480 and 3,030 or so");
    expect(card.textContent).toContain("Resting energy expenditure");
    expect(card.textContent).toContain("1,780 kcal");
    const list = await openSheet();
    fireEvent.click(within(list).getByRole("option", { name: /^Very sedentary/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await result("Today's expenditure")).textContent).toContain("2,490\u00a0kcal"); // x 1.40
    expect(activityRow().textContent).toContain("Very sedentary · 1.40");
  });

  it("the row says the chosen level and its coefficient", async () => {
    renderRoute("/tools/energy");
    await result("Today's expenditure");
    expect(activityRow().textContent).toBe("Your activity Sedentary / light activity · 1.55");
  });

  it("the chosen option carries the check and aria-selected", async () => {
    save({ lastInputs: { energy: { pal: "active" } } });
    renderRoute("/tools/energy");
    await result("Today's expenditure");
    const list = await openSheet();
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    expect(options.map((o) => o.querySelector("svg") !== null)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(options[2]!.textContent).toContain("1.75");
  });

  it("arrow keys move focus without picking", async () => {
    renderRoute("/tools/energy");
    await result("Today's expenditure");
    const list = await openSheet();
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.tabIndex)).toEqual([-1, 0, -1, -1]);
    options[1]!.focus();
    fireEvent.keyDown(options[1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(options[2]!, { key: "ArrowDown" });
    fireEvent.keyDown(options[3]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[3]);
    fireEvent.keyDown(options[3]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(options[2]);
    expect(options[2]!.tabIndex).toBe(0);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    expect(activityRow().textContent).toContain("Sedentary / light activity · 1.55");
  });

  it("Enter picks the focused option and closes", async () => {
    renderRoute("/tools/energy");
    await result("Today's expenditure");
    const list = await openSheet();
    const options = within(list).getAllByRole("option");
    fireEvent.keyDown(options[1]!, { key: "ArrowUp" });
    fireEvent.keyDown(options[0]!, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(activityRow().textContent).toContain("Very sedentary · 1.40");
  });

  it("Escape closes with no change and focus goes back to the row", async () => {
    renderRoute("/tools/energy");
    await result("Today's expenditure");
    activityRow().focus();
    const list = await openSheet();
    fireEvent.keyDown(within(list).getAllByRole("option")[1]!, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(activityRow().textContent).toContain("Sedentary / light activity · 1.55");
    await waitFor(() => expect(document.activeElement).toBe(activityRow()));
  });

  it("the row and the result change before the sheet has left", async () => {
    vi.spyOn(motion, "exitWillAnimate").mockReturnValue(true);
    try {
      renderRoute("/tools/energy");
      await result("Today's expenditure");
      const before = (await result("Today's expenditure")).textContent;
      const list = await openSheet();
      fireEvent.click(within(list).getByRole("option", { name: /^Active/ }));
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(activityRow().textContent).toContain("Active · 1.75");
      expect((await result("Today's expenditure")).textContent).not.toBe(before);
      await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("does not crash on an empty or out-of-range value", async () => {
    renderRoute("/tools/energy");
    await result("Today's expenditure");
    type("Age", "");
    type("Age", "9999");
    type("Height", "");
    type("Weight", "0");
    expect(await result("Today's expenditure")).toBeTruthy();
  });

  it("shares the formula choice on the device", async () => {
    renderRoute("/tools/energy");
    await result("Today's expenditure");
    fireEvent.click(screen.getByRole("radio", { name: "Male" }));
    expect(JSON.parse(localStorage.getItem(TOOL_STATE_KEY) ?? "{}").formula).toBe("male");
  });
});

describe("protein", () => {
  it("the day range is a large figure, the meals in muted labels", async () => {
    save({ weightKg: 100, lastInputs: { protein: { goal: "maintain" } } });
    renderRoute("/tools/protein");
    const card = await result("Per day");
    const figure = card.querySelector('[data-slot="result-figure"]');
    expect(figure?.textContent).toMatch(/^\d.*\u00a0g$/);
    for (const label of ["Over 3 meals", "Over 4 meals"]) {
      const el = within(card).getByText(label);
      expect(el.className).toContain("text-muted-foreground");
      expect(el.className).not.toContain("text-primary-ink");
    }
  });

  it("falls back without body fat, then applies the cut floor", async () => {
    save({ weightKg: 100, lastInputs: { protein: { goal: "cut" } } });
    renderRoute("/tools/protein");
    const card = await result("Per day");
    expect(card.textContent).toContain("180 to 250\u00a0g"); // 1.8-2.5 g/kg
    expect(screen.getByText(/Without a body-fat value/)).toBeTruthy();
    type("Body fat (optional)", "40");
    expect((await result("Per day")).textContent).toContain("160 to 185\u00a0g");
    expect(screen.getByText(/the floor Belay keeps when cutting/)).toBeTruthy();
  });

  it("pre-fills body fat from the device and derives meals from the day range", async () => {
    save({ weightKg: 100, bodyFatPct: 40, lastInputs: { protein: { goal: "cut" } } });
    renderRoute("/tools/protein");
    const card = await result("Per day");
    expect(
      (screen.getByRole("textbox", { name: "Body fat (optional)" }) as HTMLInputElement).value,
    ).toBe("40");
    expect(card.textContent).toContain("160 to 185\u00a0g");
    expect(card.textContent).toContain("55 to 60 g"); // 3 meals: ceil(160/3), floor(185/3)
  });

  it("does not crash on an empty or out-of-range value", async () => {
    save({ lastInputs: { protein: { goal: "cut" } } });
    renderRoute("/tools/protein");
    await result("Per day");
    type("Weight", "");
    type("Weight", "9999");
    type("Body fat (optional)", "");
    type("Body fat (optional)", "999");
    expect(await result("Per day")).toBeTruthy();
  });
});

describe("projection", () => {
  it("gives a range of weeks and refuses a goal at or above the current weight", async () => {
    save({ weightKg: 82, lastInputs: { projection: { targetKg: 75 } } });
    renderRoute("/tools/projection");
    const card = await result("Goal reached");
    expect(card.textContent).toContain(
      "In 12 to 16 weeks. Loss slows down as you lose weight, hence a range.",
    );
    type("Goal", "82");
    expect((await result("Goal reached")).textContent).toBe(
      "Goal reachedThe projection works out a weight loss; your goal is already reached or above your current weight.",
    );
  });

  it("a stepper press that lands on a preset keeps fine tuning and the focus", async () => {
    save({ lastInputs: { projection: { pct: 0.7 } } });
    renderRoute("/tools/projection");
    await result("Goal reached");
    const plus = screen.getByRole("button", { name: "Increase Pace (% per week)" });
    plus.focus();
    fireEvent.click(plus);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>("textbox", { name: "Pace (% per week)" }).value,
      ).toMatch(/0[.,]75/),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Increase Pace (% per week)" }),
    );
  });

  it("states the source at 1% and Belay's advice above 1.5%", async () => {
    renderRoute("/tools/projection");
    await result("Goal reached");
    fireEvent.click(screen.getByRole("button", { name: "Fine-tune ›" }));
    type("Pace (% per week)", "1,2");
    expect(screen.getByText(/In athletes, a pace of about 1% per week/)).toBeTruthy();
    type("Pace (% per week)", "2");
    expect(
      screen.getByText(/Belay suggests being followed by a doctor or a dietitian/),
    ).toBeTruthy();
  });

  it("shows no pace warning when the goal is not below the current weight", async () => {
    renderRoute("/tools/projection");
    await result("Goal reached");
    fireEvent.click(screen.getByRole("button", { name: "Fine-tune ›" }));
    type("Pace (% per week)", "2");
    expect(screen.queryByText(/Belay suggests being followed/)).toBeTruthy();
    type("Goal", "82");
    expect(screen.queryByText(/Belay suggests being followed/)).toBeNull();
  });

  it("sets the pace with a segment and states it as a line", async () => {
    save({ weightKg: 80.4, lastInputs: { projection: { targetKg: 75 } } });
    renderRoute("/tools/projection");
    const group = await screen.findByRole("radiogroup", { name: "Your pace (loss per week)" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Gentle", "Balanced", "Steady"]);
    expect(
      within(group).getByRole("radio", { name: "Balanced" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("0.75% · 0.6 kg per week")).toBeTruthy();
    const before = (await result("Goal reached")).textContent;
    fireEvent.click(within(group).getByRole("radio", { name: "Steady" }));
    expect(screen.getByText("1% · 0.8 kg per week")).toBeTruthy();
    expect((await result("Goal reached")).textContent).not.toBe(before);
  });

  it("opens a stored pace that matches no preset in fine tuning", async () => {
    save({ lastInputs: { projection: { targetKg: 75, pct: 1.2, fine: false } } });
    renderRoute("/tools/projection");
    await result("Goal reached");
    expect(screen.queryByRole("radiogroup", { name: /Your pace/ })).toBeNull();
    expect(screen.getByRole("textbox", { name: /Pace \(% per week\)/ })).toBeTruthy();
  });

  it("does not crash on an empty or out-of-range value", async () => {
    renderRoute("/tools/projection");
    await result("Goal reached");
    type("Average weight", "");
    type("Goal", "9999");
    fireEvent.click(screen.getByRole("button", { name: "Fine-tune ›" }));
    type("Pace (% per week)", "");
    type("Pace (% per week)", "99");
    expect(await result("Goal reached")).toBeTruthy();
  });
});
