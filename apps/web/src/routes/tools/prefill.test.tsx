import { addDays } from "@belay/shared/body/dates";
import type { Change } from "@belay/shared/sync/schema";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { TOOL_STATE_KEY } from "../../lib/tool-storage";
import { openAccountDb, readProfile } from "../../sync/db";
import { writeLastUser } from "../../sync/last-user";
import { fakeApi } from "../../test/fake-api";
import { renderRoute } from "../../test/render-route";
import { ADA, seed, weight } from "../../test/seed";

const AT = "2026-10-01T06:30:00.000Z";
const profile = (field: "formula" | "birthYear" | "height", value: string | number): Change =>
  ({ kind: "profile", field, value, at: AT }) as Change;
// 80.0, 80.1, 80.2, 80.3 from 3 October: a 7-day average of 80.15, shown 80.2.
const FOUR_DAYS = [0, 1, 2, 3].map((i) => weight(addDays("2026-10-03", i), 80 + i / 10));
const PROFILE = [profile("formula", "male"), profile("birthYear", 1995), profile("height", 178)];

beforeEach(() => {
  indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 9, 0));
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

async function openTool(tool: string, changes: Change[]) {
  await seed(ADA.id, changes);
  writeLastUser(ADA);
  fakeApi({ me: "down" }); // offline: the profile and the tracking are on the phone
  renderRoute(`/tools/${tool}`);
}
const field = (name: string) => screen.findByRole("textbox", { name }) as Promise<HTMLInputElement>;
const hintOf = (input: HTMLElement) =>
  input
    .getAttribute("aria-describedby")
    ?.split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .join("|");

describe("a connected tool", () => {
  it("opens from the profile and the 7-day average, each value saying where it comes from", async () => {
    await openTool("energy", [...PROFILE, ...FOUR_DAYS]);
    await waitFor(async () => expect((await field("Age")).value).toBe("31"));
    expect(screen.getByRole("radio", { name: "Male" }).getAttribute("aria-checked")).toBe("true");
    expect((await field("Height")).value).toBe("178");
    expect((await field("Weight")).value).toBe("80.2");
    expect(hintOf(await field("Age"))).toContain("from your year of birth");
    expect(hintOf(await field("Height"))).toContain("from your profile");
    expect(hintOf(await field("Weight"))).toContain("your 7-day average");
    expect(screen.getAllByText("from your profile")).toHaveLength(2); // the formula and the height
    // Mifflin for a man of 31, 178 cm and 80.2 kg, × 1.55 (sedentary, the default).
    expect(
      (await screen.findByRole("region", { name: "Today's expenditure" })).textContent,
    ).toContain("2,730kcal");
  });

  it("drops a field's source once the person changes it, and offers to update the profile", async () => {
    await openTool("energy", [...PROFILE, ...FOUR_DAYS]);
    const height = await field("Height");
    await waitFor(() => expect(height.value).toBe("178"));
    fireEvent.change(height, { target: { value: "180" } });
    expect(hintOf(height)).not.toContain("from your profile");
    const offer = await screen.findByRole("group", { name: "Profile update" });
    expect(offer.textContent).toBe(
      "Your profile says 178 cm. Update your profile with 180 cm?UpdateNo, just here",
    );
    fireEvent.click(within(offer).getByRole("button", { name: "No, just here" }));
    expect(screen.queryByRole("group", { name: "Profile update" })).toBeNull();
    fireEvent.change(height, { target: { value: "181" } }); // a new value: asked again
    fireEvent.click(
      within(await screen.findByRole("group", { name: "Profile update" })).getByRole("button", {
        name: "Update",
      }),
    );
    await waitFor(async () =>
      expect((await readProfile(await openAccountDb(ADA.id))).heightCm).toBe(181),
    );
    await waitFor(() => expect(screen.queryByRole("group", { name: "Profile update" })).toBeNull());
  });

  it("never offers to update the profile with the age or the weight", async () => {
    await openTool("energy", [...PROFILE, ...FOUR_DAYS]);
    const age = await field("Age");
    await waitFor(() => expect(age.value).toBe("31"));
    fireEvent.change(age, { target: { value: "40" } });
    fireEvent.change(await field("Weight"), { target: { value: "82" } });
    expect(screen.queryByRole("group", { name: "Profile update" })).toBeNull();
  });

  it("goes back to the device's own values on request", async () => {
    localStorage.setItem(
      TOOL_STATE_KEY,
      JSON.stringify({
        formula: "female",
        heightCm: 165,
        weightKg: 62,
        lastInputs: { energy: { ageYears: 45 } },
      }),
    );
    await openTool("energy", [...PROFILE, ...FOUR_DAYS]);
    await waitFor(async () => expect((await field("Height")).value).toBe("178"));
    fireEvent.click(screen.getByRole("button", { name: "Back to my last entries" }));
    expect((await field("Height")).value).toBe("165");
    expect((await field("Age")).value).toBe("45");
    expect((await field("Weight")).value).toBe("62");
    expect(screen.getByRole("radio", { name: "Female" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("from your profile")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to my last entries" })).toBeNull();
  });

  it("leaves out a value outside the tool's bounds, without a word", async () => {
    await openTool("bmi", [profile("height", 178), weight("2026-10-06", 22)]);
    await waitFor(async () => expect((await field("Height")).value).toBe("178"));
    expect((await field("Weight")).value).toBe("70"); // the device's: 22 kg is under 30
    expect(hintOf(await field("Weight"))).not.toContain("weigh-in");
  });

  it("takes the last weigh-in without an average, for the protein and projection tools", async () => {
    await openTool("protein", [weight("2026-10-06", 79.8)]);
    await waitFor(async () => expect((await field("Weight")).value).toBe("79.8"));
    expect(hintOf(await field("Weight"))).toContain("your last weigh-in");
  });

  it("fills the body-fat tool from the last measurements, with their day", async () => {
    await openTool("body-fat", [
      ...PROFILE,
      { kind: "measure", date: "2026-10-06", field: "waist", value: 82, at: AT },
      { kind: "measure", date: "2026-10-06", field: "neck", value: 39, at: AT },
    ]);
    const neck = await field("Neck");
    await waitFor(() => expect(neck.value).toBe("39"));
    expect((await field("Waist at the navel")).value).toBe("82");
    expect(hintOf(neck)).toContain("measured on Tue, Oct 6");
    expect((await field("Height")).value).toBe("178");
    expect(hintOf(await field("Height"))).toContain("from your profile");
  });

  it("keeps the body-fat height field while it is typed in, with the offer under it", async () => {
    localStorage.setItem(TOOL_STATE_KEY, JSON.stringify({ heightCm: 165 }));
    await openTool("body-fat", PROFILE);
    const height = await field("Height");
    await waitFor(() => expect(height.value).toBe("178"));
    height.focus();
    fireEvent.change(height, { target: { value: "1" } });
    fireEvent.change(height, { target: { value: "18" } });
    fireEvent.change(height, { target: { value: "180" } });
    expect(await field("Height")).toBe(height);
    expect(height.value).toBe("180");
    expect(document.activeElement).toBe(height);
    const offer = await screen.findByRole("group", { name: "Profile update" });
    expect(offer.textContent).toContain("Update your profile with 180 cm?");
  });

  it("offers the way back only for what is on screen (no hip for the male formula)", async () => {
    await openTool("body-fat", [
      profile("formula", "male"),
      { kind: "measure", date: "2026-10-06", field: "hip", value: 95, at: AT },
    ]);
    const back = await screen.findByRole("button", { name: "Back to my last entries" }); // the formula
    fireEvent.click(back);
    expect(screen.queryByRole("button", { name: "Back to my last entries" })).toBeNull();
  });

  it("renders a signed-out tool as in M1: no hint node, no dangling description", async () => {
    fakeApi({ me: null });
    for (const tool of ["energy", "body-fat"]) {
      renderRoute(`/tools/${tool}`);
      await field("Height");
      expect(document.querySelectorAll('[id$="-hint"]')).toHaveLength(0);
      for (const el of document.querySelectorAll("[aria-describedby]"))
        for (const id of el.getAttribute("aria-describedby")!.split(" "))
          expect(document.getElementById(id)).not.toBeNull();
      cleanup();
    }
  });

  it("stays as in M1 when signed out, or with an empty profile and no tracking", async () => {
    await openTool("energy", []);
    expect((await field("Age")).value).toBe("30");
    expect((await field("Height")).value).toBe("170");
    expect(screen.queryByRole("button", { name: "Back to my last entries" })).toBeNull();
    cleanup();
    fakeApi({ me: null });
    localStorage.clear();
    renderRoute("/tools/energy");
    expect((await field("Height")).value).toBe("170");
    expect(screen.queryByText(/from your/)).toBeNull();
  });
});

describe("in French", () => {
  it("says where the values come from, and asks before updating the profile", async () => {
    await i18n.changeLanguage("fr");
    await openTool("energy", [...PROFILE, ...FOUR_DAYS]);
    const height = await field("Taille");
    await waitFor(() => expect(height.value).toBe("178"));
    expect(hintOf(height)).toContain("depuis ton profil");
    expect(hintOf(await field("Âge"))).toContain("depuis ton année de naissance");
    expect(hintOf(await field("Poids"))).toContain("ta moyenne 7 jours");
    fireEvent.change(height, { target: { value: "180" } });
    const offer = await screen.findByRole("group", { name: "Mise à jour du profil" });
    expect(offer.textContent).toContain(
      "Ton profil indique 178 cm. Mettre à jour ton profil avec 180 cm ?",
    );
    expect(within(offer).getByRole("button", { name: "Non, juste ici" })).toBeTruthy();
  });
});
