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
    expect(within(card).getByText("Epley").nextElementSibling?.textContent).toBe("116.5\u00a0kg");
    expect(within(card).getByText("Brzycki").nextElementSibling?.textContent).toBe("112.5\u00a0kg");
  });

  it("with Epley only on this device, one figure under Epley", async () => {
    localStorage.setItem("belay.oneRepMaxBrzycki", "hidden");
    renderRoute("/tools/one-rep-max");
    const card = await result("Your estimated 1RM");
    expect(within(card).getByText("Epley").nextElementSibling?.textContent).toBe("116.5\u00a0kg");
    expect(within(card).queryByText("Brzycki")).toBeNull();
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
    expect(within(card).getByRole("img").getAttribute("class")).toContain("w-full");
  });

  it("offers the loads just below and above an unreachable target", async () => {
    renderRoute("/tools/plates");
    await result("On each side");
    type("Target load", "101");
    expect(screen.getByText("101 kg can't be loaded with your equipment.")).toBeTruthy();
    const below = screen.getByText("Just below · 100 kg");
    expect(below.nextElementSibling?.textContent).toBe("20 + 20 kg per side");
    const above = screen.getByText("Just above · 105 kg");
    expect(above.nextElementSibling?.textContent).toBe("20 + 20 + 2.5 kg per side");
  });

  it("My equipment is a row that says the preset and opens the equipment page", async () => {
    renderRoute("/tools/plates");
    const link = await screen.findByRole("link", { name: "My equipment Gym" });
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { name: "My equipment" })).toBeTruthy();
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
      "150 kg 10 + 5 per side× 5",
      "275 kg 20 + 5 + 2.5 per side× 3",
      "100 kg working setsyour call",
    ]);
  });

  it("the warm-up list stays a polite live region", async () => {
    renderRoute("/tools/warmup");
    const list = await result("Your warm-up");
    const live = list.parentElement!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.getAttribute("aria-atomic")).toBe("true");
  });

  it("collapses a warm-up entirely at the bar into one bar-only set", async () => {
    renderRoute("/tools/warmup");
    await result("Your warm-up");
    type("Working load", "26");
    fireEvent.click(screen.getByRole("button", { name: "Increase Warm-up" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase Warm-up" }));
    const rows = within(await result("Your warm-up")).getAllByRole("listitem");
    expect(rows.map((li) => li.textContent)).toEqual([
      "120 kg bar only× 5",
      "26 kg working setsyour call",
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
    expect(screen.queryByRole("textbox", { name: "Warm-up" })).toBeNull();
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

describe("in pounds", () => {
  const pounds = () => localStorage.setItem("belay.weightUnit", "lb");
  const field = (label: string) =>
    (screen.getByRole("textbox", { name: label }) as HTMLInputElement).value;
  const saved = () => JSON.parse(localStorage.getItem(TOOL_STATE_KEY)!);

  it("in pounds 1RM takes lb and answers whole pounds", async () => {
    pounds();
    renderRoute("/tools/one-rep-max");
    const card = await result("Your estimated 1RM");
    // 100 kg stored, read as 220 lb on the 5 lb step.
    expect(field("Load")).toBe("220");
    expect(within(card).getByText("Epley").nextElementSibling?.textContent).toBe("257 lb");
    type("Reps", "6");
    type("Load", "225");
    expect(within(card).getByText("Epley").nextElementSibling?.textContent).toBe("270 lb");
    expect(within(card).getByText("Brzycki").nextElementSibling?.textContent).toBe("261 lb");
    expect(saved().lastInputs["one-rep-max"].loadKg).toBeCloseTo(102.058, 3);
    expect(card.textContent).not.toContain("kg");
  });

  it("in pounds Disques loads 225 as 45 + 45 per side on a 45 lb bar", async () => {
    pounds();
    renderRoute("/tools/plates");
    await result("On each side");
    type("Target load", "225");
    const card = await result("On each side");
    const drawing = within(card).getByRole("img", { name: "45 + 45 lb per side" });
    expect(within(card).getByText("45 lb bar")).toBeTruthy();
    // No colour code for pound plates: every plate is drawn grey.
    for (const plate of drawing.querySelectorAll("g > rect"))
      expect(plate.getAttribute("class")).toContain("fill-plate-grey");
    expect(saved().lastInputs.plates.targetKg).toBeCloseTo(102.058, 3);
    type("Target load", "223");
    expect(screen.getByText("223 lb can't be loaded with your equipment.")).toBeTruthy();
    expect(screen.getByText(/^Just below · \d+ lb$/)).toBeTruthy();
    expect(card.textContent).not.toContain("kg");
  });

  it("in pounds Échauffement for 225 lists lb loads from the lb set", async () => {
    pounds();
    renderRoute("/tools/warmup");
    await result("Your warm-up");
    type("Working load", "225");
    const rows = within(await result("Your warm-up"))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    // 102 kg asks for two sets, at about half and three quarters, on a 45 lb bar.
    expect(rows).toEqual([
      "1110 lb 25 + 5 + 2.5 per side× 5",
      "2170 lb 35 + 25 + 2.5 per side× 3",
      "225 lb working setsyour call",
    ]);
  });

  it("in pounds Matériel shows the lb set read-only and leaves the kg set stored", async () => {
    pounds();
    const stored = {
      equipment: { preset: "custom", bar: 15, plates: [20, 10, 1.25] },
      lastInputs: {},
    };
    localStorage.setItem(TOOL_STATE_KEY, JSON.stringify(stored));
    renderRoute("/tools/plates/equipment");
    expect(await screen.findByRole("heading", { name: "My equipment" })).toBeTruthy();
    expect(screen.getByText("In pounds, Belay uses a 45 lb bar and standard plates.")).toBeTruthy();
    expect(screen.getByText("45 lb")).toBeTruthy();
    for (const plate of ["45", "35", "25", "10", "5", "2.5"])
      expect(screen.getByText(plate, { exact: true })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(JSON.parse(localStorage.getItem(TOOL_STATE_KEY)!).equipment).toEqual(stored.equipment);
  });

  it("in pounds Disques and Échauffement name the pound set Standard (lb)", async () => {
    pounds();
    renderRoute("/tools/plates");
    expect(await screen.findByRole("link", { name: "My equipment Standard (lb)" })).toBeTruthy();
    cleanup();
    renderRoute("/tools/warmup");
    await result("Your warm-up");
    expect(screen.getByText(/Standard \(lb\)/)).toBeTruthy();
    expect(screen.queryByText(/Gym/)).toBeNull();
  });

  it("in kilos nothing changes", async () => {
    localStorage.setItem("belay.weightUnit", "kg");
    renderRoute("/tools/plates");
    const card = await result("On each side");
    expect(within(card).getByRole("img", { name: "20 + 20 kg per side" })).toBeTruthy();
    expect(within(card).getByText("20 kg bar")).toBeTruthy();
    cleanup();
    renderRoute("/tools/plates/equipment");
    expect(await screen.findByRole("button", { name: "Edit this equipment" })).toBeTruthy();
    expect(screen.queryByText("In pounds, Belay uses a 45 lb bar and standard plates.")).toBeNull();
  });
});
