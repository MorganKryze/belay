// The rules that turn exercises-dataset into Belay's library (spec §5.1 to §5.4). Pure: the
// import script fetches and writes, these functions decide, and the tests read them on samples.
import { type Exercise, type ExerciseRow, isExerciseId, toExercise, toRow } from "./library";
import { type Equipment, INCREMENT_KG, isEquipment, isMuscle, type Muscle } from "./muscles";

// MIT, © 2026 Hasan Emir Yıldırım. Pinned: an import never changes unless this commit does.
export const DATASET = {
  repo: "MorganKryze/exercises-dataset",
  commit: "7455efae41b330c265e7cd4b78dfa848e7ce5ebd",
  file: "data/exercises.json",
} as const;
export const DATASET_URL = `https://raw.githubusercontent.com/${DATASET.repo}/${DATASET.commit}/${DATASET.file}`;

// The only fields read from a record. The media fields (image, gif_url, media_id, attribution)
// are © Gym visual: never read, never written.
export interface DatasetRecord {
  id: string;
  name: string;
  equipment: string;
  target: string;
  secondary: string[];
  steps: { en: string[]; fr: string[] };
}

const strings = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string"))
    throw new Error(`${what}: not a list of strings`);
  return v;
};

export function readRecord(raw: unknown): DatasetRecord {
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^\d{4}$/.test(r.id)) throw new Error("a record has no id");
  for (const key of ["name", "equipment", "target"] as const)
    if (typeof r[key] !== "string") throw new Error(`exercise ${r.id}: no ${key}`);
  const steps = r.instruction_steps as Record<string, unknown> | undefined;
  return {
    id: r.id,
    name: r.name as string,
    equipment: r.equipment as string,
    target: r.target as string,
    secondary: strings(r.secondary_muscles ?? [], `exercise ${r.id}: secondary_muscles`),
    steps: {
      en: strings(steps?.en, `exercise ${r.id}: steps (en)`),
      fr: strings(steps?.fr, `exercise ${r.id}: steps (fr)`),
    },
  };
}

// Every label of the dataset, as a target or a secondary muscle (§5.2). "delts" is decided by
// the exercise's name, "shoulders" and "deltoids" by its primary muscle; null: not a muscle Belay
// counts. A label missing here fails the import: no muscle is ever guessed.
const LABELS: Readonly<Record<string, Muscle | "delts" | "shoulders" | null>> = {
  pectorals: "chest",
  chest: "chest",
  "upper chest": "chest",
  delts: "delts",
  shoulders: "shoulders",
  deltoids: "shoulders",
  "rear deltoids": "rear_delts",
  "rotator cuff": "rear_delts",
  lats: "lats",
  "latissimus dorsi": "lats",
  "upper back": "upper_back",
  traps: "upper_back",
  trapezius: "upper_back",
  rhomboids: "upper_back",
  back: "upper_back",
  "levator scapulae": "upper_back",
  spine: "lower_back",
  "lower back": "lower_back",
  biceps: "biceps",
  brachialis: "biceps",
  triceps: "triceps",
  forearms: "forearms",
  wrists: "forearms",
  "wrist flexors": "forearms",
  "wrist extensors": "forearms",
  hands: "forearms",
  "grip muscles": "forearms",
  abs: "abs",
  core: "abs",
  obliques: "abs",
  abdominals: "abs",
  "lower abs": "abs",
  "serratus anterior": "abs",
  quads: "quads",
  quadriceps: "quads",
  glutes: "glutes",
  abductors: "glutes",
  adductors: "adductors",
  groin: "adductors",
  "inner thighs": "adductors",
  hamstrings: "hamstrings",
  calves: "calves",
  soleus: "calves",
  "hip flexors": null,
  ankles: null,
  feet: null,
  "ankle stabilizers": null,
  shins: null,
  sternocleidomastoid: null,
};
const REAR = /rear|reverse fl|face pull/;
const SIDE = /lateral raise|side raise|upright row|y-raise/;
// A pull works the back of the shoulder; anything else, its front.
const PULLS: ReadonlySet<Muscle> = new Set(["lats", "upper_back", "rear_delts", "biceps"]);

function label(name: string, record: DatasetRecord) {
  if (!(name in LABELS)) throw new Error(`exercise ${record.id}: unknown muscle label "${name}"`);
  return LABELS[name]!;
}

export function musclesOf(record: DatasetRecord): { primary: Muscle; secondary: Muscle[] } {
  const target = label(record.target, record);
  if (target === null || target === "shoulders")
    throw new Error(`exercise ${record.id}: "${record.target}" cannot be a primary muscle`);
  const primary: Muscle =
    target !== "delts"
      ? target
      : REAR.test(record.name)
        ? "rear_delts"
        : SIDE.test(record.name)
          ? "side_delts"
          : "front_delts";
  const secondary: Muscle[] = [];
  for (const name of record.secondary) {
    const found = label(name, record);
    if (found === "delts") throw new Error(`exercise ${record.id}: "delts" as a secondary muscle`);
    const muscle =
      found === "shoulders" ? (PULLS.has(primary) ? "rear_delts" : "front_delts") : found;
    if (muscle !== null && muscle !== primary && !secondary.includes(muscle))
      secondary.push(muscle);
  }
  return { primary, secondary };
}

// §5.4: every other label (kettlebell, band, ball, roller, rope…) is "other".
const EQUIPMENT_OF: Readonly<Record<string, Equipment>> = {
  barbell: "barbell",
  "ez barbell": "barbell",
  "olympic barbell": "barbell",
  "trap bar": "barbell",
  dumbbell: "dumbbell",
  "leverage machine": "machine",
  "smith machine": "machine",
  "sled machine": "machine",
  assisted: "machine",
  "skierg machine": "machine",
  "stationary bike": "machine",
  "elliptical machine": "machine",
  "stepmill machine": "machine",
  "upper body ergometer": "machine",
  cable: "cable",
  "body weight": "bodyweight",
  weighted: "bodyweight",
};
export const equipmentOf = (name: string): Equipment => EQUIPMENT_OF[name] ?? "other";

// The dataset's UTF-8 was read once as another encoding: "sled 45в° leg press".
export const fixEncoding = (text: string) => text.replaceAll("в°", "°");
export const sentenceCase = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
// Another camera angle, or the same exercise shown by a man or a woman.
const VARIANT = /\s*\((?:side pov|back pov|front pov|male|female)\)/g;

// §5.3, validated: the exercises of the starter program and of M3b's rule, set by hand.
export const OVERRIDES: Readonly<Record<string, { primary: Muscle; secondary: Muscle[] }>> = {
  "ds:0025": { primary: "chest", secondary: ["triceps", "front_delts"] }, // barbell bench press
  "ds:0405": { primary: "front_delts", secondary: ["side_delts", "triceps"] }, // db seated shoulder press
  "ds:0739": { primary: "quads", secondary: ["glutes"] }, // sled 45° leg press
  "ds:0334": { primary: "side_delts", secondary: [] }, // dumbbell lateral raise
  "ds:0201": { primary: "triceps", secondary: [] }, // cable pushdown
  "ds:0605": { primary: "calves", secondary: [] }, // lever standing calf raise
  "ds:0043": { primary: "quads", secondary: ["glutes", "adductors"] }, // barbell full squat
  "ds:0085": { primary: "hamstrings", secondary: ["glutes", "lower_back"] }, // barbell romanian deadlift
  "ds:0410": { primary: "quads", secondary: ["glutes"] }, // dumbbell single leg split squat
  "ds:0586": { primary: "hamstrings", secondary: [] }, // lever lying leg curl
  "ds:0314": { primary: "chest", secondary: ["front_delts", "triceps"] }, // db incline bench press
  "ds:0175": { primary: "abs", secondary: [] }, // cable kneeling crunch
  "ds:0594": { primary: "calves", secondary: [] }, // lever seated calf raise
  "belay:barbell-hip-thrust": { primary: "glutes", secondary: ["hamstrings"] },
  "ds:0327": { primary: "upper_back", secondary: ["lats", "rear_delts", "biceps"] }, // db incline row
  "ds:0585": { primary: "quads", secondary: [] }, // lever leg extension
  "ds:0662": { primary: "chest", secondary: ["triceps", "front_delts"] }, // push-up
  "belay:cable-face-pull": { primary: "rear_delts", secondary: ["upper_back"] },
  "ds:0385": { primary: "forearms", secondary: [] }, // dumbbell reverse wrist curl
  "ds:0872": { primary: "abs", secondary: [] }, // reverse crunch
  "ds:2330": { primary: "lats", secondary: ["biceps", "upper_back"] }, // cable lat pulldown, full ROM
  "ds:0294": { primary: "biceps", secondary: ["forearms"] }, // dumbbell biceps curl
};

type Entry = { exercise: Exercise; steps: { en: readonly string[]; fr: readonly string[] } };

// D15: two exercises of the starter program the dataset lacks, with Belay's own text.
export const BELAY_EXERCISES: readonly Entry[] = [
  {
    exercise: {
      id: "belay:barbell-hip-thrust",
      name: "Barbell hip thrust",
      primary: ["glutes"],
      secondary: ["hamstrings"],
      equipment: "barbell",
      incrementKg: INCREMENT_KG.barbell,
    },
    steps: {
      en: [
        "Sit on the floor with your upper back against the long side of a bench and a padded barbell across your hips.",
        "Plant your feet flat, about hip-width apart, knees bent.",
        "Drive through your heels to lift your hips until your thighs and torso form a straight line, squeezing your glutes at the top.",
        "Lower your hips slowly back toward the floor.",
        "Repeat for the desired number of repetitions.",
      ],
      fr: [
        "Assieds-toi au sol, le haut du dos contre le long côté d'un banc, une barre protégée d'un manchon posée sur tes hanches.",
        "Pose tes pieds à plat, écartés à la largeur des hanches, les genoux fléchis.",
        "Pousse dans tes talons pour monter les hanches jusqu'à ce que tes cuisses et ton buste soient alignés, en serrant les fessiers en haut.",
        "Redescends lentement les hanches vers le sol.",
        "Répète le nombre de répétitions souhaité.",
      ],
    },
  },
  {
    exercise: {
      id: "belay:cable-face-pull",
      name: "Cable face pull",
      primary: ["rear_delts"],
      secondary: ["upper_back"],
      equipment: "cable",
      incrementKg: INCREMENT_KG.cable,
    },
    steps: {
      en: [
        "Set a rope handle on a cable pulley at about head height.",
        "Grasp the rope with both hands, palms facing each other, and step back until your arms are straight in front of you.",
        "Pull the rope toward your face, elbows high and out to the sides, pulling the ends of the rope apart.",
        "Pause, squeezing your shoulder blades together, then return slowly until your arms are straight.",
        "Repeat for the desired number of repetitions.",
      ],
      fr: [
        "Fixe une corde sur une poulie réglée à peu près à hauteur de tête.",
        "Saisis la corde à deux mains, paumes face à face, et recule jusqu'à avoir les bras tendus devant toi.",
        "Tire la corde vers ton visage, les coudes hauts et vers l'extérieur, en écartant les deux bouts de la corde.",
        "Marque une pause en serrant les omoplates, puis reviens lentement jusqu'à avoir les bras tendus.",
        "Répète le nombre de répétitions souhaité.",
      ],
    },
  },
];

// The four generated files of src/exercises/data. `ids` lists every id ever published: an id
// never leaves the index (the history points to it), even when the dataset drops its exercise.
export interface LibraryFiles {
  index: ExerciseRow[];
  fr: Record<string, string[]>;
  en: Record<string, string[]>;
  ids: string[];
}

export function buildLibrary(raw: readonly unknown[], previous: LibraryFiles | null): LibraryFiles {
  const records = raw
    .map(readRecord)
    .filter((r) => r.target !== "cardiovascular system") // cardio is an activity (M3b)
    .map((r) => ({
      ...r,
      name: fixEncoding(r.name),
      steps: { en: r.steps.en.map(fixEncoding), fr: r.steps.fr.map(fixEncoding) },
    }));
  // The plain version may be gone upstream and still in the index: its variant stays out.
  const names = new Set(
    [...records.map((r) => r.name), ...(previous?.index ?? []).map((row) => row[1])].map((n) =>
      n.toLowerCase(),
    ),
  );
  const entries: Entry[] = records
    .filter((r) => {
      const base = r.name.replace(VARIANT, "");
      return base === r.name || !names.has(base.toLowerCase());
    })
    .map((r) => {
      const id = `ds:${r.id}`;
      const { primary, secondary } = OVERRIDES[id] ?? musclesOf(r);
      const equipment = equipmentOf(r.equipment);
      return {
        exercise: {
          id,
          name: sentenceCase(r.name),
          primary: [primary],
          secondary,
          equipment,
          incrementKg: INCREMENT_KG[equipment],
        },
        steps: r.steps,
      };
    });
  entries.push(...BELAY_EXERCISES);
  const fresh = new Set(entries.map((e) => e.exercise.id));
  for (const row of previous?.index ?? [])
    if (!fresh.has(row[0]))
      entries.push({
        exercise: toExercise(row),
        steps: { en: previous!.en[row[0]] ?? [], fr: previous!.fr[row[0]] ?? [] },
      });
  entries.sort((a, b) => (a.exercise.id < b.exercise.id ? -1 : 1));
  return {
    index: entries.map((e) => toRow(e.exercise)),
    en: Object.fromEntries(entries.map((e) => [e.exercise.id, [...e.steps.en]])),
    fr: Object.fromEntries(entries.map((e) => [e.exercise.id, [...e.steps.fr]])),
    ids: [...new Set([...(previous?.ids ?? []), ...fresh])].sort(),
  };
}

const isStepList = (v: unknown) =>
  Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim() !== "");

// What `pnpm exercises:check` verifies on the committed files, offline. Empty: all good.
export function checkLibrary(files: LibraryFiles): string[] {
  const problems: string[] = [];
  const text = JSON.stringify(files);
  if (text.includes("в°")) problems.push('a text still holds "в°"');
  if (/gif_url|media_id|gymvisual|\.gif\b/i.test(text)) problems.push("a media field or URL");
  const rows = new Map<string, ExerciseRow>();
  for (const row of files.index) {
    const [id, name, primary, secondary, equipment, incrementKg] = row;
    const where = `index ${JSON.stringify(id)}`;
    if (row.length !== 6 || typeof id !== "string" || !isExerciseId(id)) {
      problems.push(`${where}: not a row of six fields with a valid id`);
      continue;
    }
    if (rows.has(id)) problems.push(`${where}: twice`);
    rows.set(id, row);
    if (typeof name !== "string" || name.trim() === "") problems.push(`${where}: no name`);
    if (!Array.isArray(primary) || primary.length !== 1 || !primary.every(isMuscle))
      problems.push(`${where}: the primary muscle is not one of the 16`);
    if (
      !Array.isArray(secondary) ||
      !secondary.every(isMuscle) ||
      new Set(secondary).size !== secondary.length ||
      secondary.some((m) => primary.includes(m))
    )
      problems.push(`${where}: a secondary muscle is not one of the 16, or repeats`);
    if (!isEquipment(equipment) || incrementKg !== INCREMENT_KG[equipment])
      problems.push(`${where}: unknown equipment or wrong increment`);
    for (const lang of ["fr", "en"] as const)
      if (!isStepList(files[lang][id])) problems.push(`${where}: no steps in ${lang}`);
  }
  for (const lang of ["fr", "en"] as const)
    for (const id of Object.keys(files[lang]))
      if (!rows.has(id)) problems.push(`${lang}: steps of ${id}, which the index lacks`);
  for (const [id, { primary, secondary }] of Object.entries(OVERRIDES)) {
    const row = rows.get(id);
    if (!row || row[2].join() !== primary || row[3].join() !== secondary.join())
      problems.push(`override ${id}: not applied`);
  }
  for (const { exercise } of BELAY_EXERCISES)
    if (!rows.has(exercise.id)) problems.push(`${exercise.id}: missing`);
  for (const id of files.ids) if (!rows.has(id)) problems.push(`${id}: published, then removed`);
  for (const id of rows.keys())
    if (!files.ids.includes(id)) problems.push(`${id}: missing from ids.json`);
  return problems;
}
