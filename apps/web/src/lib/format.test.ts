import { SEED_PROGRAM_ID, seedId } from "@belay/shared/training/stored-program";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import {
  formatDay,
  formatKg,
  formatNumber,
  formatPlates,
  formatShortDay,
  formatWeekday,
  formatWeekRange,
  lossView,
  parseDecimal,
  programName,
  rotationTitle,
  sessionName,
  sessionTitle,
  workoutTitle,
} from "./format";

describe("parseDecimal", () => {
  it.each([
    ["72,5", 72.5],
    ["72.5", 72.5],
    [" 72 ", 72],
    ["1 790", 1790],
    ["72,", 72],
    [",5", 0.5],
  ])("%j → %d", (text, value) => {
    expect(parseDecimal(text)).toBe(value);
  });

  it.each(["", "abc", "7,2,5", "-3", "1e3", "72kg"])("%j → null", (text) => {
    expect(parseDecimal(text)).toBeNull();
  });
});

describe("formatNumber", () => {
  it("uses the decimal comma in French and the point in English", () => {
    expect(formatNumber(24.3, "fr")).toBe("24,3");
    expect(formatNumber(24.3, "en")).toBe("24.3");
  });

  it("groups thousands in results but not in inputs", () => {
    expect(formatNumber(2770, "fr")).toBe("2 770");
    expect(formatNumber(2770, "fr", { grouping: false })).toBe("2770");
  });

  it("keeps trailing zeros only when asked", () => {
    expect(formatNumber(25, "fr", { minDigits: 1 })).toBe("25,0");
    expect(formatNumber(25, "fr")).toBe("25");
  });
});

describe("formatPlates", () => {
  it("joins plates with the locale's separator", () => {
    expect(formatPlates([20, 5, 2.5], "fr")).toBe("20 + 5 + 2,5");
    expect(formatPlates([20, 1.25], "en")).toBe("20 + 1.25");
  });
});

describe("formatDay", () => {
  const today = new Date(2026, 9, 3);
  it("omits this year and shows any other year", () => {
    expect(formatDay(new Date(2026, 11, 26), "fr", today)).toBe("26 décembre");
    expect(formatDay(new Date(2027, 0, 23), "fr", today)).toBe("23 janvier 2027");
    expect(formatDay(new Date(2027, 0, 23), "en", today)).toBe("January 23, 2027");
  });

  it("writes the first of the month as 1er in French only", () => {
    expect(formatDay(new Date(2026, 10, 1), "fr", today)).toBe("1er novembre");
    expect(formatDay(new Date(2027, 0, 1), "fr", today)).toBe("1er janvier 2027");
    expect(formatDay(new Date(2026, 10, 11), "fr", today)).toBe("11 novembre");
    expect(formatDay(new Date(2026, 10, 1), "en", today)).toBe("November 1");
  });
});

describe("body formats", () => {
  const today = "2026-10-07";

  it("writes weights to the tenth with their decimal", () => {
    expect(formatKg(80, "fr")).toBe("80,0");
    expect(formatKg(79.84, "en")).toBe("79.8");
  });

  it("turns a weekly change into a loss or a gain, never -0", () => {
    expect(lossView(0.62)).toEqual({ kind: "loss", value: 0.6 });
    expect(lossView(-0.25)).toEqual({ kind: "gain", value: 0.3 });
    expect(lossView(-0.04)).toEqual({ kind: "loss", value: 0 });
    expect(Object.is(lossView(-0.04).value, -0)).toBe(false);
  });

  it("writes short days, 1er in French, and the year only when it is not this one", () => {
    expect(formatShortDay("2026-09-30", "fr", today)).toBe("30 sept.");
    expect(formatShortDay("2026-10-01", "fr", today)).toBe("1er oct.");
    expect(formatShortDay("2025-12-29", "fr", today)).toBe("29 déc. 2025");
    expect(formatShortDay("2026-09-30", "en", today)).toBe("Sep 30");
  });

  it("starts a line with the weekday, capitalised, or keeps it as the language writes it", () => {
    expect(formatWeekday("2026-09-30", "fr", today)).toBe("Mer. 30 sept.");
    expect(formatWeekday("2026-09-30", "fr", today, { startOfLine: false })).toBe("mer. 30 sept.");
    expect(formatWeekday("2026-09-30", "en", today)).toBe("Wed, Sep 30");
  });

  it("writes the weekday and the month in full inside a sentence when asked", () => {
    const long = { startOfLine: false, long: true };
    expect(formatWeekday("2026-10-13", "fr", today, long)).toBe("mardi 13 octobre");
    expect(formatWeekday("2026-10-01", "fr", today, long)).toBe("jeudi 1er octobre");
    expect(formatWeekday("2026-10-13", "en", today, long)).toBe("Tuesday, October 13");
  });

  it("writes a week with its month once when it shares it", () => {
    expect(formatWeekRange("2026-09-22", "2026-09-28", "fr", today)).toBe("22 – 28 sept.");
    expect(formatWeekRange("2026-09-29", "2026-10-05", "fr", today)).toBe("29 sept. – 5 oct.");
    expect(formatWeekRange("2026-06-01", "2026-06-07", "fr", today)).toBe("1er – 7 juin");
    expect(formatWeekRange("2026-09-22", "2026-09-28", "en", today)).toBe("Sep 22 – 28");
    expect(formatWeekRange("2025-12-29", "2026-01-04", "fr", "2026-01-10")).toBe(
      "29 déc. 2025 – 4 janv.",
    );
  });
});

describe("session and program titles", () => {
  const fr = i18n.getFixedT("fr");
  const en = i18n.getFixedT("en");
  const OWN = "0199c3a2-7b1e-7cc0-8f3e-000000000a01";

  it("titles a session by its letter and the name it shows, or by its letter alone", () => {
    expect(sessionTitle("D", fr, "Haut du corps")).toBe("Séance D · Haut du corps");
    expect(sessionTitle("D", en, "Upper body")).toBe("Session D · Upper body");
    expect(sessionTitle("A", fr, null)).toBe("Séance A");
    expect(sessionTitle("D", en, null)).toBe("Session D");
  });

  it("names a session started before sessions recorded theirs by its letter's starting session", () => {
    expect(sessionTitle("A", fr)).toBe("Séance A · Push");
    expect(sessionTitle("C", en)).toBe("Session C · Glutes + light pull");
    expect(sessionTitle("D", fr)).toBe("Séance D");
  });

  it("titles a rotation session by its stored name, a starting session by its own name wherever it sits", () => {
    expect(rotationTitle({ code: "A", sessionId: seedId(2), name: null }, fr)).toBe(
      "Séance A · Legs",
    );
    expect(rotationTitle({ code: "B", sessionId: seedId(1), name: "Pecs" }, fr)).toBe(
      "Séance B · Pecs",
    );
    expect(rotationTitle({ code: "D", sessionId: OWN, name: "Gainage" }, en)).toBe(
      "Session D · Gainage",
    );
    expect(rotationTitle({ code: "E", sessionId: OWN, name: null }, fr)).toBe("Séance E");
  });

  it("titles a session done by its letter and the current name of the session it recorded", () => {
    const sessions = [
      { id: OWN, name: "Tirage lourd" },
      { id: seedId(3), name: null },
    ];
    expect(workoutTitle({ sessionCode: "C", sessionId: OWN }, sessions, fr)).toBe(
      "Séance C · Tirage lourd",
    );
    expect(workoutTitle({ sessionCode: "A", sessionId: seedId(3) }, sessions, en)).toBe(
      "Session A · Glutes + light pull",
    );
    // A session this device does not hold (yet): its letter alone, or a starting session's name.
    expect(workoutTitle({ sessionCode: "D", sessionId: seedId(9) }, [], fr)).toBe("Séance D");
    expect(workoutTitle({ sessionCode: "B", sessionId: seedId(1) }, [], fr)).toBe(
      "Séance B · Push",
    );
    // Recorded before sessions kept their id: its letter's starting session (HF2).
    expect(workoutTitle({ sessionCode: "B" }, sessions, fr)).toBe("Séance B · Legs");
    expect(workoutTitle({ sessionCode: "A", sessionId: null }, sessions, en)).toBe(
      "Session A · Push",
    );
  });

  it("titles a session done by the name its session held that day, whatever it is called now (HN5)", () => {
    const sessions = [
      { id: OWN, name: "Bas du corps" },
      { id: seedId(1), name: "Pecs" },
      { id: seedId(3), name: "Tirage" },
    ];
    expect(
      workoutTitle({ sessionCode: "B", sessionId: OWN, sessionName: "Legs" }, sessions, fr),
    ).toBe("Séance B · Legs");
    // None that day: a starting session's own name in the language shown, else the letter alone.
    expect(
      workoutTitle({ sessionCode: "A", sessionId: seedId(1), sessionName: null }, sessions, fr),
    ).toBe("Séance A · Push");
    expect(
      workoutTitle({ sessionCode: "C", sessionId: seedId(3), sessionName: null }, sessions, en),
    ).toBe("Session C · Glutes + light pull");
    expect(
      workoutTitle({ sessionCode: "D", sessionId: OWN, sessionName: null }, sessions, fr),
    ).toBe("Séance D");
    // Kept with no session id (not written by this app, still read): the name, else the letter.
    expect(workoutTitle({ sessionCode: "E", sessionName: "Gainage" }, [], fr)).toBe(
      "Séance E · Gainage",
    );
    // Not kept (started before names were): the current name, as before.
    expect(workoutTitle({ sessionCode: "B", sessionId: OWN }, sessions, fr)).toBe(
      "Séance B · Bas du corps",
    );
  });

  it("names a set-aside session by its name, a starting one by its own, else untitled", () => {
    expect(sessionName({ id: OWN, name: "Partagée par Lou" }, fr)).toBe("Partagée par Lou");
    expect(sessionName({ id: seedId(2), name: null }, en)).toBe("Legs");
    expect(sessionName({ id: OWN, name: null }, fr)).toBe("Séance sans nom");
    expect(sessionName({ id: OWN, name: null }, en)).toBe("Untitled session");
  });

  it("names a program by its name, the starting one by default, else untitled", () => {
    expect(programName({ id: OWN, name: "Haut / bas" }, fr)).toBe("Haut / bas");
    expect(programName({ id: SEED_PROGRAM_ID, name: null }, fr)).toBe("Programme de départ");
    expect(programName({ id: SEED_PROGRAM_ID, name: null }, en)).toBe("Starter program");
    expect(programName({ id: OWN, name: null }, fr)).toBe("Programme sans nom");
    expect(programName({ id: OWN, name: null }, en)).toBe("Untitled program");
  });
});
