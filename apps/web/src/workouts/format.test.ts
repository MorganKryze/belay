import { afterEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import "../i18n/lazy";
import { formatRest } from "./format";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("formatRest", () => {
  it("keeps minutes and seconds on the line of their number, in English and in French", async () => {
    expect(formatRest(120, i18n.t)).toBe("2 min");
    expect(formatRest(150, i18n.t)).toBe("2 min 30 s");
    await i18n.changeLanguage("fr");
    expect(formatRest(150, i18n.t)).toBe("2 min 30");
  });
});
