import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { TOOL_STATE_KEY } from "../../lib/tool-storage";
import { renderRoute } from "../../test/render-route";

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
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

describe("BMI", () => {
  it("places the value on the WHO ranges with a sentence, in French", async () => {
    await i18n.changeLanguage("fr");
    save({ heightCm: 178, weightKg: 77 });
    renderRoute("/tools/bmi");
    const card = await result("Ton IMC");
    expect(card.textContent).toContain("24,3");
    expect(card.textContent).toContain("Dans la plage de référence de l'OMS (18,5 à 25).");
    const current = screen
      .getByRole("list", { name: "Plages de l'OMS" })
      .querySelector("[aria-current]");
    expect(current?.textContent).toContain("Plage de référence de l'OMS");
  });

  it("classifies the value shown: 24.97 shows 25.0 and sits in 25 – 30", async () => {
    save({ heightCm: 180, weightKg: 80.9 });
    renderRoute("/tools/bmi");
    const card = await result("Your BMI");
    expect(card.textContent).toContain("25.0");
    expect(card.textContent).toContain("Above the WHO reference range (25 to 30).");
  });

  it("suggests a professional from 35", async () => {
    save({ heightCm: 170, weightKg: 102 }); // 35.3
    renderRoute("/tools/bmi");
    expect((await result("Your BMI")).textContent).toContain(
      "If you have questions about your weight, talk to a health professional.",
    );
  });

  it("still works when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    renderRoute("/tools/bmi");
    await result("Your BMI");
    type("Height", "178");
    type("Weight", "77");
    expect((await result("Your BMI")).textContent).toContain("24.3");
  });
});

describe("body fat", () => {
  it("reproduces the DoD vector and marks the Gallagher band", async () => {
    save({
      formula: "male",
      heightCm: 177.8,
      lastInputs: { "body-fat": { ageYears: 30, neckCm: 39.5, waistCm: 86.5 } },
    });
    renderRoute("/tools/body-fat");
    const card = await result("Your estimated body fat");
    expect(card.textContent).toContain("17%");
    const list = screen.getByRole("list", { name: "Reference values" });
    expect(list.querySelector("[aria-current]")?.textContent).toContain(
      "Matches a BMI of 18.5 to 25",
    );
    expect(within(list).getByText("8 – 19%")).toBeTruthy();
    expect(
      screen.getByText("For the male formula, ages 20 to 39 (Gallagher 2000, table 4)."),
    ).toBeTruthy();
  });

  it("refuses a waist smaller than the neck with a message, never NaN", async () => {
    save({ formula: "male", heightCm: 178 });
    renderRoute("/tools/body-fat");
    await result("Your estimated body fat");
    type("Waist at the navel", "40");
    type("Neck", "45");
    const card = await result("Your estimated body fat");
    expect(card.textContent).toContain("Your waist must be larger than your neck.");
    expect(card.textContent).not.toMatch(/NaN|Infinity/);
    expect(
      screen.getByRole("textbox", { name: "Waist at the navel" }).getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("shows no reference values outside 20–79", async () => {
    save({ lastInputs: { "body-fat": { ageYears: 17 } } });
    renderRoute("/tools/body-fat");
    await result("Your estimated body fat");
    expect(
      screen.getByText(
        "The published reference values cover ages 20 to 79, so only the estimate is shown for your age.",
      ),
    ).toBeTruthy();
  });

  it("switches to the Asian reference set from the sheet and remembers it", async () => {
    save({
      formula: "male",
      heightCm: 177.8,
      lastInputs: { "body-fat": { ageYears: 30, neckCm: 39.5, waistCm: 86.5 } },
    });
    renderRoute("/tools/body-fat");
    await result("Your estimated body fat");
    fireEvent.click(screen.getByRole("radio", { name: "Asian" }));
    expect(
      within(screen.getByRole("list", { name: "Reference values" })).getByText("13 – 22%"),
    ).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(TOOL_STATE_KEY)!).bodyFatReference).toBe("asian");
  });
});

describe("guards", () => {
  it("both pages parse an empty state", async () => {
    const { BmiInputs } = await import("./bmi");
    const { BodyFatInputs } = await import("./body-fat");
    expect(BmiInputs.safeParse({}).success).toBe(true);
    expect(BodyFatInputs.safeParse({}).success).toBe(true);
  });

  it("BMI renders with an empty or corrupted state", async () => {
    localStorage.setItem(TOOL_STATE_KEY, "{not json");
    renderRoute("/tools/bmi");
    expect((await result("Your BMI")).textContent).not.toMatch(/NaN|Infinity/);
  });

  it("BMI band follows the rounded value: 18.45 shows 18.5 in the reference range", async () => {
    save({ heightCm: 200, weightKg: 73.8 });
    renderRoute("/tools/bmi");
    const card = await result("Your BMI");
    expect(card.textContent).toContain("18.5");
    expect(card.textContent).toContain("In the WHO reference range");
  });

  it("BMI suggests a professional below 18.5", async () => {
    save({ heightCm: 180, weightKg: 55 });
    renderRoute("/tools/bmi");
    expect((await result("Your BMI")).textContent).toContain("talk to a health professional");
  });

  it("body fat renders with an empty state and no NaN", async () => {
    renderRoute("/tools/body-fat");
    expect((await result("Your estimated body fat")).textContent).not.toMatch(/NaN|Infinity/);
  });

  it("female: the tightest girths still give a message on the card, never NaN or a negative", async () => {
    // Field minimums (waist 40 + hips 50) always exceed the largest neck (80), so
    // "waist + hips <= neck" cannot be typed; the formula's own guard is tested in shared.
    save({ formula: "female", heightCm: 170 });
    renderRoute("/tools/body-fat");
    await result("Your estimated body fat");
    type("Neck", "80");
    type("Waist at the narrowest", "40");
    type("Hips", "50");
    const card = await result("Your estimated body fat");
    expect(card.textContent).toContain("fall outside what the formula can handle");
    expect(card.textContent).not.toMatch(/NaN|Infinity|-\d/);
  });

  it("shows a message instead of a number outside 2 to 75 %", async () => {
    save({ formula: "male", heightCm: 230 });
    renderRoute("/tools/body-fat");
    await result("Your estimated body fat");
    type("Neck", "80");
    type("Waist at the navel", "81");
    const card = await result("Your estimated body fat");
    expect(card.textContent).toContain("fall outside what the formula can handle");
    expect(card.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("toggling the formula on empty storage shares nothing", async () => {
    renderRoute("/tools/body-fat");
    await result("Your estimated body fat");
    fireEvent.click(screen.getByRole("radio", { name: "Male" }));
    type("Age", "40");
    expect(JSON.parse(localStorage.getItem(TOOL_STATE_KEY) ?? "{}").bodyFatPct).toBeUndefined();
  });

  it("shares the estimate once neck and waist are entered with a stored height", async () => {
    save({ formula: "male", heightCm: 177.8 });
    renderRoute("/tools/body-fat");
    await result("Your estimated body fat");
    type("Neck", "39.5");
    expect(JSON.parse(localStorage.getItem(TOOL_STATE_KEY)!).bodyFatPct).toBeUndefined();
    type("Waist at the navel", "86.5");
    expect(JSON.parse(localStorage.getItem(TOOL_STATE_KEY)!).bodyFatPct).toBe(17);
  });

  it("female without hips shares nothing", async () => {
    save({ formula: "female", heightCm: 170 });
    renderRoute("/tools/body-fat");
    await result("Your estimated body fat");
    type("Neck", "35");
    type("Waist at the narrowest", "76");
    expect(JSON.parse(localStorage.getItem(TOOL_STATE_KEY)!).bodyFatPct).toBeUndefined();
    type("Hips", "101");
    expect(JSON.parse(localStorage.getItem(TOOL_STATE_KEY)!).bodyFatPct).toBeGreaterThan(0);
  });

  it("keeps a value typed elsewhere when the page is only opened", async () => {
    save({ bodyFatPct: 22 });
    renderRoute("/tools/body-fat");
    await result("Your estimated body fat");
    expect(JSON.parse(localStorage.getItem(TOOL_STATE_KEY)!).bodyFatPct).toBe(22);
  });

  it("clears the shared value when an edit makes the estimate invalid", async () => {
    save({
      formula: "male",
      heightCm: 177.8,
      bodyFatPct: 17,
      lastInputs: { "body-fat": { ageYears: 30, neckCm: 39.5, waistCm: 86.5 } },
    });
    renderRoute("/tools/body-fat");
    await result("Your estimated body fat");
    type("Neck", "39");
    expect(JSON.parse(localStorage.getItem(TOOL_STATE_KEY)!).bodyFatPct).toBe(17);
    type("Neck", "80");
    type("Waist at the navel", "40");
    expect(JSON.parse(localStorage.getItem(TOOL_STATE_KEY)!).bodyFatPct).toBeUndefined();
  });
});
