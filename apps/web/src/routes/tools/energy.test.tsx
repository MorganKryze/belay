import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
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
  it("multiplies Mifflin by the chosen FAO level", async () => {
    save({
      formula: "male",
      heightCm: 180,
      weightKg: 80,
      lastInputs: { energy: { ageYears: 30 } },
    });
    renderRoute("/tools/energy");
    const card = await result("Today's expenditure");
    expect(card.textContent).toContain("2,760kcal"); // 1780 x 1.55
    expect(card.textContent).toContain("between 2,480 and 3,030 or so");
    expect(card.textContent).toContain("Resting energy expenditure");
    expect(card.textContent).toContain("1,780 kcal");
    fireEvent.click(screen.getByRole("radio", { name: /^Very sedentary/ }));
    expect((await result("Today's expenditure")).textContent).toContain("2,490kcal"); // x 1.40
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
  it("falls back without body fat, then applies the cut floor", async () => {
    save({ weightKg: 100, lastInputs: { protein: { goal: "cut" } } });
    renderRoute("/tools/protein");
    const card = await result("Per day");
    expect(card.textContent).toContain("180 to 250g"); // 1.8-2.5 g/kg
    expect(screen.getByText(/Without a body-fat value/)).toBeTruthy();
    type("Body fat (optional)", "40");
    expect((await result("Per day")).textContent).toContain("160 to 185g");
    expect(screen.getByText(/the floor Belay keeps when cutting/)).toBeTruthy();
  });

  it("pre-fills body fat from the device and derives meals from the day range", async () => {
    save({ weightKg: 100, bodyFatPct: 40, lastInputs: { protein: { goal: "cut" } } });
    renderRoute("/tools/protein");
    const card = await result("Per day");
    expect(
      (screen.getByRole("textbox", { name: "Body fat (optional)" }) as HTMLInputElement).value,
    ).toBe("40");
    expect(card.textContent).toContain("160 to 185g");
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

  it("shows the presets with their kg per week at the current weight", async () => {
    save({ weightKg: 82 });
    renderRoute("/tools/projection");
    const list = await screen.findByRole("radiogroup", { name: /Your pace/ });
    expect(within(list).getByRole("radio", { name: /Balanced/ }).textContent).toContain(
      "0.75% · 0.6 kg",
    );
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
