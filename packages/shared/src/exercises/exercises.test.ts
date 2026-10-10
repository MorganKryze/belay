import { describe, expect, it } from "vitest";
import { EXERCISES, exerciseById, isKnownExercise } from "./catalog";
import en from "./data/en.json";
import fr from "./data/fr.json";
import ids from "./data/ids.json";
import index from "./data/index.json";
import {
  BELAY_EXERCISES,
  buildLibrary,
  checkLibrary,
  type DatasetRecord,
  equipmentOf,
  type LibraryFiles,
  musclesOf,
  OVERRIDES,
} from "./import";
import type { ExerciseRow } from "./library";
import { MUSCLES } from "./muscles";

const committed = { index, fr, en, ids } as unknown as LibraryFiles;

// A dataset record as the source holds it, media fields included.
const raw = (
  id: string,
  name: string,
  target: string,
  secondary: string[] = [],
  equipment = "barbell",
) => ({
  id,
  name,
  category: "chest",
  body_part: "chest",
  equipment,
  target,
  secondary_muscles: secondary,
  muscle_group: target,
  instructions: { en: "One.", fr: "Un." },
  instruction_steps: { en: [`Do ${name}.`], fr: [`Fais ${name}.`], it: ["Fai."] },
  image: "https://gymvisual.example/x.png",
  gif_url: "https://gymvisual.example/x.gif",
  media_id: "123",
  attribution: "Gym visual",
  created_at: "2026-01-01",
});
const record = (name: string, target: string, secondary: string[] = []): DatasetRecord => ({
  id: "9999",
  name,
  equipment: "barbell",
  target,
  secondary,
  steps: { en: [], fr: [] },
});

describe("musclesOf (§5.2)", () => {
  it("decides delts by the name: rear, side, otherwise front", () => {
    expect(musclesOf(record("cable rear delt row", "delts")).primary).toBe("rear_delts");
    expect(musclesOf(record("band reverse fly", "delts")).primary).toBe("rear_delts");
    expect(musclesOf(record("cable face pull", "delts")).primary).toBe("rear_delts");
    expect(musclesOf(record("dumbbell lateral raise", "delts")).primary).toBe("side_delts");
    expect(musclesOf(record("barbell upright row", "delts")).primary).toBe("side_delts");
    expect(musclesOf(record("band y-raise", "delts")).primary).toBe("side_delts");
    expect(musclesOf(record("dumbbell shoulder press", "delts")).primary).toBe("front_delts");
  });

  it("puts a secondary shoulder at the back for a pull, at the front otherwise", () => {
    expect(musclesOf(record("row", "upper back", ["shoulders"])).secondary).toEqual(["rear_delts"]);
    expect(musclesOf(record("curl", "biceps", ["deltoids"])).secondary).toEqual(["rear_delts"]);
    expect(musclesOf(record("press", "pectorals", ["shoulders"])).secondary).toEqual([
      "front_delts",
    ]);
  });

  it("drops what Belay does not count, the primary repeated, and duplicates", () => {
    expect(
      musclesOf(
        record("squat", "glutes", ["quadriceps", "hip flexors", "abductors", "quads", "core"]),
      ),
    ).toEqual({ primary: "glutes", secondary: ["quads", "abs"] });
    expect(musclesOf(record("crunch", "serratus anterior", ["obliques"]))).toEqual({
      primary: "abs",
      secondary: [],
    });
  });

  it("fails on a label it does not know, never guesses", () => {
    expect(() => musclesOf(record("x", "pectorals", ["neck"]))).toThrow(
      'exercise 9999: unknown muscle label "neck"',
    );
    expect(() => musclesOf(record("x", "biceps femoris"))).toThrow(/unknown muscle label/);
    expect(() => musclesOf(record("x", "hip flexors"))).toThrow(/cannot be a primary muscle/);
  });
});

describe("equipmentOf (§5.4)", () => {
  it.each([
    ["barbell", "barbell"],
    ["ez barbell", "barbell"],
    ["trap bar", "barbell"],
    ["dumbbell", "dumbbell"],
    ["leverage machine", "machine"],
    ["smith machine", "machine"],
    ["assisted", "machine"],
    ["stationary bike", "machine"],
    ["cable", "cable"],
    ["body weight", "bodyweight"],
    ["weighted", "bodyweight"],
    ["kettlebell", "other"],
    ["band", "other"],
    ["rope", "other"],
  ])("%s → %s", (label, equipment) => {
    expect(equipmentOf(label)).toBe(equipment);
  });
});

describe("buildLibrary", () => {
  const source = [
    raw("0025", "barbell bench press", "pectorals", ["triceps", "shoulders"]),
    raw("0043", "barbell full squat", "glutes", ["quadriceps"]),
    raw("1461", "barbell full squat (back pov)", "glutes", ["quadriceps"]),
    raw("0739", "sled 45в° leg press", "glutes", ["quadriceps"], "sled machine"),
    raw("1464", "sled 45в° leg press (back pov)", "glutes", ["quadriceps"], "sled machine"),
    raw("3214", "arms apart circular toe touch (male)", "abs", [], "body weight"),
    raw("2141", "air bike", "cardiovascular system", [], "stationary bike"),
  ];
  const built = buildLibrary(source, null);
  const row = (id: string) => built.index.find((r) => r[0] === id);

  it("keeps one view of each exercise, no cardio, and fixes the encoding", () => {
    expect(built.index.map((r) => r[0])).toEqual([
      "belay:barbell-hip-thrust",
      "belay:cable-face-pull",
      "ds:0025",
      "ds:0043",
      "ds:0739",
      "ds:3214",
    ]);
    expect(row("ds:0739")?.[1]).toBe("Sled 45° leg press");
    expect(row("ds:3214")?.[1]).toBe("Arms apart circular toe touch (male)"); // no plain version
  });

  it("applies the hand corrections over the rules, with equipment and increment", () => {
    expect(row("ds:0025")).toEqual([
      "ds:0025",
      "Barbell bench press",
      ["chest"],
      ["triceps", "front_delts"],
      "barbell",
      2.5,
    ] satisfies ExerciseRow);
    expect(row("ds:0739")).toEqual([
      "ds:0739",
      "Sled 45° leg press",
      ["quads"],
      ["glutes"],
      "machine",
      5,
    ]);
    expect(row("ds:3214")?.slice(4)).toEqual(["bodyweight", 2.5]);
  });

  it("writes the steps in French and English only, and never a media field", () => {
    expect(built.fr["ds:0025"]).toEqual(["Fais barbell bench press."]);
    expect(built.en["ds:0025"]).toEqual(["Do barbell bench press."]);
    expect(built.fr["belay:cable-face-pull"]).toHaveLength(5);
    expect(JSON.stringify(built)).not.toMatch(/gymvisual|gif|media_id|attribution|Fai\./);
  });

  it("keeps an exercise the dataset dropped, and gives the same files twice", () => {
    const later = buildLibrary(
      source.filter((r) => r.id !== "0043"),
      built,
    );
    expect(later).toEqual(built);
    expect(buildLibrary(source, built)).toEqual(built);
  });

  it("fails the whole import on an unknown label", () => {
    expect(() => buildLibrary([raw("0001", "x", "pectorals", ["neck"])], null)).toThrow(
      /unknown muscle label "neck"/,
    );
  });
});

describe("checkLibrary", () => {
  const sample = buildLibrary(
    [raw("0025", "barbell bench press", "pectorals"), raw("0043", "barbell full squat", "glutes")],
    null,
  );
  // The overrides need every starter exercise; a sample has two, so only its own problems count.
  const own = (files: LibraryFiles) => checkLibrary(files).filter((p) => !/^override ds:/.test(p));

  it("passes a library it built", () => {
    expect(own(sample)).toEqual([]);
  });

  it("finds a muscle outside the 16, a published id removed, media, and the bad encoding", () => {
    const broken: LibraryFiles = {
      ...sample,
      index: sample.index
        .filter((r) => r[0] !== "ds:0043")
        .map((r) =>
          r[0] === "ds:0025" ? [r[0], "Sled 45в°", ["pecs" as never], [], "barbell", 2.5] : r,
        ),
      fr: { ...sample.fr, "ds:0025": ["https://x.example/a.gif"] },
    };
    expect(own(broken)).toEqual([
      'a text still holds "в°"',
      "a media field or URL",
      'index "ds:0025": the primary muscle is not one of the 16',
      "fr: steps of ds:0043, which the index lacks",
      "en: steps of ds:0043, which the index lacks",
      "ds:0043: published, then removed",
    ]);
  });
});

describe("the committed library", () => {
  it("passes every check of `pnpm exercises:check`", () => {
    expect(checkLibrary(committed)).toEqual([]);
  });

  it("holds about 1 290 exercises, the 22 corrections and Belay's two", () => {
    expect(EXERCISES).toHaveLength(1290);
    expect(Object.keys(OVERRIDES)).toHaveLength(22);
    for (const { exercise } of BELAY_EXERCISES) expect(exerciseById(exercise.id)).toEqual(exercise);
    expect(exerciseById("ds:0739")).toEqual({
      id: "ds:0739",
      name: "Sled 45° leg press",
      primary: ["quads"],
      secondary: ["glutes"],
      equipment: "machine",
      incrementKg: 5,
    });
    expect(isKnownExercise("ds:0025")).toBe(true);
    expect(isKnownExercise("ds:9999")).toBe(false);
  });

  it("uses every one of the 16 muscles as a primary somewhere", () => {
    const used = new Set(EXERCISES.flatMap((e) => e.primary));
    expect(MUSCLES.filter((m) => !used.has(m))).toEqual([]);
  });
});
