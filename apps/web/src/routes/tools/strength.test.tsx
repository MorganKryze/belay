import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { TOOL_STATE_KEY } from "../../lib/tool-storage";
import { renderRoute } from "../../test/render-route";
import { EquipmentInputs } from "./equipment";
import { OneRepMaxInputs } from "./one-rep-max";
import { PlatesInputs } from "./plates";
import { WarmupInputs } from "./warmup";

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

describe("one-rep max", () => {
  it("shows both formulas side by side", async () => {
    renderRoute("/tools/one-rep-max");
    const card = await result("Your estimated 1RM");
    expect(within(card).getByText("Epley").nextElementSibling?.textContent).toBe("116.5kg");
    expect(within(card).getByText("Brzycki").nextElementSibling?.textContent).toBe("112.5kg");
  });

  it("warns beyond 10 reps and never accepts more than 12", async () => {
    renderRoute("/tools/one-rep-max");
    await result("Your estimated 1RM");
    type("Reps", "11");
    expect(screen.getByText("Beyond 10 reps, the estimate is less reliable.")).toBeTruthy();
    type("Reps", "15");
    expect((screen.getByRole("textbox", { name: "Reps" }) as HTMLInputElement).value).toBe("12");
  });
});

describe("plates", () => {
  it("draws the bar and says the plates in words", async () => {
    renderRoute("/tools/plates");
    const card = await result("On each side");
    expect(within(card).getByRole("img", { name: "20 + 20 kg per side" })).toBeTruthy();
    expect(within(card).getByText("20 kg bar")).toBeTruthy();
  });

  it("offers the loads just below and above an unreachable target", async () => {
    renderRoute("/tools/plates");
    await result("On each side");
    type("Target load", "101");
    expect(screen.getByText("101 kg can't be loaded with your equipment.")).toBeTruthy();
    expect(screen.getByText("Just below: 100 kg (20 + 20 kg per side)")).toBeTruthy();
    expect(screen.getByText("Just above: 105 kg (20 + 20 + 2.5 kg per side)")).toBeTruthy();
  });
});

describe("my equipment", () => {
  it("keeps presets read-only and copies one into Custom on Edit", async () => {
    renderRoute("/tools/plates/equipment");
    expect(await screen.findByRole("heading", { name: "My equipment" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "25" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit this equipment" }));
    expect(screen.getByText("Copied from “Gym”. Tap a plate to add or remove it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "1.25" }));
    const saved = JSON.parse(localStorage.getItem(TOOL_STATE_KEY)!);
    expect(saved.equipment).toEqual({ preset: "custom", bar: 20, plates: [20, 10, 5, 2.5, 1.25] });
  });
});

describe("warm-up", () => {
  it("lists the sets rounded to the gym preset, then the working sets", async () => {
    renderRoute("/tools/warmup");
    const card = await result("Your warm-up");
    const rows = within(card)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows).toEqual([
      "150 kg10 + 5 per side× 5",
      "275 kg20 + 5 + 2.5 per side× 3",
      "100 kgworking setsyour call",
    ]);
  });

  it("collapses a warm-up entirely at the bar into one bar-only set", async () => {
    renderRoute("/tools/warmup");
    await result("Your warm-up");
    type("Working load", "26");
    fireEvent.click(screen.getByRole("button", { name: "Increase Warm-up" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase Warm-up" }));
    const rows = within(await result("Your warm-up")).getAllByRole("listitem");
    expect(rows.map((li) => li.textContent)).toEqual([
      "120 kgbar only× 5",
      "26 kgworking setsyour call",
    ]);
  });

  it("explains when the working load is the bar or lighter", async () => {
    renderRoute("/tools/warmup");
    await result("Your warm-up");
    type("Working load", "20");
    expect(
      screen.getByText(
        "Your working load is the bar alone or lighter: there is no warm-up to work out.",
      ),
    ).toBeTruthy();
  });
});

describe("robustness", () => {
  it("every page schema parses an empty object", () => {
    for (const schema of [OneRepMaxInputs, PlatesInputs, EquipmentInputs, WarmupInputs]) {
      expect(schema.safeParse({}).success).toBe(true);
    }
  });

  it("does not crash on out-of-range or empty values", async () => {
    renderRoute("/tools/one-rep-max");
    await result("Your estimated 1RM");
    type("Load", "0");
    type("Load", "99999");
    type("Load", "");
    type("Reps", "0");
    type("Reps", "");
    expect(await result("Your estimated 1RM")).toBeTruthy();
  });

  it("does not crash on out-of-range values on plates and warm-up", async () => {
    renderRoute("/tools/plates");
    await result("On each side");
    type("Target load", "99999");
    type("Target load", "");
    expect(await result("On each side")).toBeTruthy();
    cleanup();
    renderRoute("/tools/warmup");
    await result("Your warm-up");
    type("Working load", "99999");
    type("Working load", "");
    expect(await result("Your warm-up")).toBeTruthy();
  });

  it("does not crash on corrupted saved inputs", async () => {
    localStorage.setItem(
      TOOL_STATE_KEY,
      JSON.stringify({ lastInputs: { "one-rep-max": { loadKg: "x", reps: 99 } } }),
    );
    renderRoute("/tools/one-rep-max");
    expect(await result("Your estimated 1RM")).toBeTruthy();
  });
});
