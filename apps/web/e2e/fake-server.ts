import { isCreatineName } from "@belay/shared/body/supplements";
import { mergeSlotChange } from "@belay/shared/sync/merge";
import type {
  Change,
  ProgramSlotRow,
  Rejected,
  SyncRequest,
  WeightRow,
} from "@belay/shared/sync/schema";
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const LOOP = fileURLToPath(new URL("fixtures/loop.mp4", import.meta.url));

export const ADA = { id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8e", displayName: "Ada" };

type Row = Record<string, unknown> & { seq: number };
// A row as the answer carries it: without the fake's own sequence number.
const bare = (row: Row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "seq"));

// The API behind page.route: /api/me answers Ada, /api/sync merges like the real server (the
// later write wins, field by field) and sends back what changed since the cursor. Flip
// `offline` to make every call fail, `session` to answer 401. `changes` are entries already on
// the server, as another device would have sent them; `push` adds more during a test. `media` makes the instance serve exercise
// loops (the synthetic clip), except the numbers in `missingLoops`.
export async function fakeServer(
  page: Page,
  {
    rows = [] as { date: string; weightKg: number }[],
    changes = [] as Change[],
    media = false,
    missingLoops = [] as string[],
  } = {},
) {
  const state = {
    offline: false,
    session: "live" as "live" | "expired",
    requests: [] as SyncRequest[],
    rows: new Map<string, WeightRow & { seq: number }>(),
    // Every other table, by its key: "measures|2026-10-06", "supplements|<id>", "profile".
    other: new Map<string, Row>(),
  };
  let seq = 0;
  for (const r of rows) state.rows.set(r.date, { ...r, at: `${r.date}T05:00:00.000Z`, seq: ++seq });

  const apply = (c: Change) => {
    const later = (key: string, at: string) => {
      const stored = state.other.get(key)?.[at] as string | null | undefined;
      return !stored || Date.parse(c.at) > Date.parse(stored);
    };
    const write = (key: string, empty: Record<string, unknown>, patch: Record<string, unknown>) => {
      state.other.set(key, { ...empty, ...state.other.get(key), ...patch, seq: ++seq });
    };
    switch (c.kind) {
      case "weight": {
        const stored = state.rows.get(c.date);
        if (!stored || Date.parse(c.at) > Date.parse(stored.at))
          state.rows.set(c.date, { date: c.date, weightKg: c.weightKg, at: c.at, seq: ++seq });
        return;
      }
      case "measure": {
        const key = `measures|${c.date}`;
        const [v, a] = {
          waist: ["waistCm", "waistAt"],
          neck: ["neckCm", "neckAt"],
          hip: ["hipCm", "hipAt"],
        }[c.field];
        if (later(key, a!))
          write(
            key,
            {
              date: c.date,
              waistCm: null,
              waistAt: null,
              neckCm: null,
              neckAt: null,
              hipCm: null,
              hipAt: null,
            },
            { [v!]: c.value, [a!]: c.at },
          );
        return;
      }
      case "intake": {
        const key = `intake|${c.date}`;
        const [v, a] = c.field === "kcal" ? ["kcal", "kcalAt"] : ["proteinG", "proteinAt"];
        if (later(key, a))
          write(
            key,
            { date: c.date, kcal: null, kcalAt: null, proteinG: null, proteinAt: null },
            { [v]: c.value, [a]: c.at },
          );
        return;
      }
      case "profile": {
        const [v, a] = {
          formula: ["formula", "formulaAt"],
          birthYear: ["birthYear", "birthYearAt"],
          height: ["heightCm", "heightAt"],
        }[c.field];
        if (later("profile", a!))
          write(
            "profile",
            {
              formula: null,
              formulaAt: null,
              birthYear: null,
              birthYearAt: null,
              heightCm: null,
              heightAt: null,
            },
            { [v!]: c.value, [a!]: c.at },
          );
        return;
      }
      case "supplement": {
        const key = `supplements|${c.id}`;
        const created = state.other.has(key);
        if (c.field === "name" && later(key, "nameAt"))
          write(
            key,
            {
              id: c.id,
              kind: isCreatineName(c.value) ? "creatine" : "other",
              removed: false,
              removedAt: null,
            },
            { name: c.value, nameAt: c.at },
          );
        if (c.field === "removed" && created && later(key, "removedAt"))
          write(key, {}, { removed: c.value, removedAt: c.at });
        return;
      }
      case "supplementLog": {
        const key = `supplementLogs|${c.supplementId}|${c.date}`;
        if (later(key, "at"))
          write(key, {}, { supplementId: c.supplementId, date: c.date, taken: c.taken, at: c.at });
        return;
      }
      case "annotation": {
        const key = `annotations|${c.id}`;
        if (c.field === "fields" && later(key, "fieldsAt"))
          write(
            key,
            { id: c.id, removed: false, removedAt: null },
            { date: c.date, type: c.type, label: c.label, fieldsAt: c.at },
          );
        if (c.field === "removed" && state.other.has(key) && later(key, "removedAt"))
          write(key, {}, { removed: c.value, removedAt: c.at });
        return;
      }
      case "steps": {
        const key = `steps|${c.date}`;
        if (later(key, "stepsAt")) write(key, {}, { date: c.date, steps: c.value, stepsAt: c.at });
        return;
      }
      case "activity": {
        const key = `activities|${c.id}`;
        if (c.field === "fields" && later(key, "fieldsAt"))
          write(
            key,
            { id: c.id, removed: false, removedAt: null },
            {
              date: c.date,
              type: c.type,
              durationMin: c.durationMin,
              cardioType: c.cardioType,
              climbStyle: c.climbStyle,
              climbRuns: c.climbRuns,
              climbGrade: c.climbGrade,
              climbColor: c.climbColor,
              fieldsAt: c.at,
            },
          );
        if (c.field === "removed" && state.other.has(key) && later(key, "removedAt"))
          write(key, {}, { removed: c.value, removedAt: c.at });
        return;
      }
      case "workout": {
        const key = `workouts|${c.id}`;
        if (c.field === "start") {
          if (!state.other.has(key))
            write(
              key,
              {
                id: c.id,
                planAt: null,
                startedAtAt: null,
                endedAt: null,
                endedAtAt: null,
                note: null,
                noteAt: null,
                exerciseNotes: {},
                exerciseNotesAt: null,
                removed: false,
                removedAt: null,
              },
              {
                sessionCode: c.sessionCode,
                sessionId: c.sessionId ?? null,
                plan: c.plan,
                startedAt: c.startedAt,
              },
            );
          return;
        }
        const [v, a] = {
          plan: ["plan", "planAt"],
          startedAt: ["startedAt", "startedAtAt"],
          ended: ["endedAt", "endedAtAt"],
          note: ["note", "noteAt"],
          exerciseNotes: ["exerciseNotes", "exerciseNotesAt"],
          removed: ["removed", "removedAt"],
        }[c.field];
        if (state.other.has(key) && later(key, a!)) write(key, {}, { [v!]: c.value, [a!]: c.at });
        return;
      }
      case "set": {
        const key = `sets|${c.id}`;
        if (c.field === "create") {
          if (!state.other.has(key))
            write(
              key,
              { removed: false, removedAt: null },
              {
                id: c.id,
                workoutId: c.workoutId,
                slotIndex: c.slotIndex,
                position: c.position,
                exerciseId: c.exerciseId,
                warmup: c.warmup,
                weightKg: c.weightKg,
                reps: c.reps,
                seconds: c.seconds ?? null,
                rir: c.rir,
                doneAt: c.doneAt,
                fieldsAt: c.at,
              },
            );
          return;
        }
        if (!state.other.has(key)) return;
        if (c.field === "values" && later(key, "fieldsAt"))
          write(
            key,
            {},
            {
              weightKg: c.weightKg,
              reps: c.reps,
              seconds: c.seconds ?? null,
              rir: c.rir,
              fieldsAt: c.at,
            },
          );
        if (c.field === "removed" && later(key, "removedAt"))
          write(key, {}, { removed: c.value, removedAt: c.at });
        return;
      }
      // Programs, their sessions and slots: a creation written once with every time unwritten,
      // then each field on its own, the later write winning.
      case "program": {
        const key = `programs|${c.id}`;
        if (c.field === "create") {
          if (!state.other.has(key))
            write(
              key,
              {},
              {
                id: c.id,
                name: c.name,
                nameAt: null,
                schedule: c.schedule,
                scheduleAt: null,
                removed: false,
                removedAt: null,
              },
            );
          return;
        }
        const a = `${c.field}At`;
        if (state.other.has(key) && later(key, a))
          write(key, {}, { [c.field]: c.value, [a]: c.at });
        return;
      }
      case "activeProgram": {
        if (later("activeProgram", "at"))
          write("activeProgram", {}, { programId: c.programId, at: c.at });
        return;
      }
      case "programSession": {
        const key = `programSessions|${c.id}`;
        if (c.field === "create") {
          if (!state.other.has(key))
            write(
              key,
              {},
              {
                id: c.id,
                name: c.name,
                nameAt: null,
                programId: c.programId,
                position: c.position,
                placeAt: null,
                removed: false,
                removedAt: null,
              },
            );
          return;
        }
        if (!state.other.has(key)) return;
        if (c.field === "place") {
          if (later(key, "placeAt"))
            write(key, {}, { programId: c.programId, position: c.position, placeAt: c.at });
          return;
        }
        const a = `${c.field}At`;
        if (later(key, a)) write(key, {}, { [c.field]: c.value, [a]: c.at });
        return;
      }
      case "programSlot": {
        const key = `programSlots|${c.id}`;
        if (c.field === "create") {
          if (!state.other.has(key))
            write(
              key,
              {},
              {
                id: c.id,
                sessionId: c.sessionId,
                position: c.position,
                exerciseId: c.exerciseId,
                measure: c.measure ?? null,
                repRange: c.repRange,
                sets: c.sets,
                rirTarget: c.rirTarget,
                restSec: c.restSec,
                warmupSets: c.warmupSets,
                isMain: c.isMain,
                groupKey: c.groupKey,
                rule: c.rule,
                positionAt: null,
                exerciseAt: null,
                repsAt: null,
                setsAt: null,
                rirAt: null,
                restAt: null,
                warmupsAt: null,
                mainAt: null,
                groupAt: null,
                ruleAt: null,
                removed: false,
                removedAt: null,
              },
            );
          return;
        }
        const stored = state.other.get(key);
        const merged = stored && mergeSlotChange(bare(stored) as ProgramSlotRow, c);
        if (merged) write(key, {}, merged);
        return;
      }
      default:
        return;
    }
  };
  for (const c of changes) apply(c);
  const push = (...more: Change[]) => {
    for (const c of more) apply(c);
  };

  await page.route("**/api/me", (route) =>
    state.offline
      ? route.abort("internetdisconnected")
      : state.session === "live"
        ? route.fulfill({ json: media ? { ...ADA, media: true } : ADA })
        : route.fulfill({ status: 401 }),
  );
  if (media) {
    // On the context, so the service worker's requests come here too.
    await page.context().route("**/media/exercises/*", (route) => {
      if (state.offline) return route.abort("internetdisconnected");
      if (state.session === "expired") return route.fulfill({ status: 401 });
      const n = new URL(route.request().url()).pathname.split("/").pop()!;
      if (missingLoops.includes(n)) return route.fulfill({ status: 404 });
      return route.fulfill({ status: 200, contentType: "video/mp4", path: LOOP });
    });
  }
  await page.route("**/api/sync", (route) => {
    if (state.offline) return route.abort("internetdisconnected");
    const request = route.request().postDataJSON() as SyncRequest;
    state.requests.push(request);
    if (state.session === "expired") return route.fulfill({ status: 401 });
    for (const c of request.changes) apply(c);
    const cursor = Number(request.cursor);
    const since = [...state.rows.values()].filter((r) => r.seq > cursor);
    const other = [...state.other].filter(([, r]) => r.seq > cursor);
    const table = (name: string) =>
      other.filter(([k]) => k.startsWith(`${name}|`)).map(([, r]) => bare(r));
    const profile = other.find(([k]) => k === "profile")?.[1];
    const active = other.find(([k]) => k === "activeProgram")?.[1];
    return route.fulfill({
      json: {
        cursor: String(
          Math.max(cursor, ...since.map((r) => r.seq), ...other.map(([, r]) => r.seq)),
        ),
        weights: since.map((r) => ({ date: r.date, weightKg: r.weightKg, at: r.at })),
        measures: table("measures"),
        intake: table("intake"),
        supplements: table("supplements"),
        supplementLogs: table("supplementLogs"),
        annotations: table("annotations"),
        steps: table("steps"),
        activities: table("activities"),
        workouts: table("workouts"),
        sets: table("sets"),
        target: null,
        profile: profile ? bare(profile) : null,
        activeProgram: active ? bare(active) : null,
        programs: table("programs"),
        programSessions: table("programSessions"),
        programSlots: table("programSlots"),
        rejected: [],
        hasMore: false,
      },
    });
  });
  return Object.assign(state, { push });
}

// Four ISO weeks around Wednesday 7 October 2026: insufficient, valid after an insufficient
// one, valid in the default range (0.7 %), and the week in progress.
export const WEEKS = [
  ...["2026-09-14", "2026-09-15", "2026-09-16"].map((date) => ({ date, weightKg: 81 })),
  ...["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].map((date) => ({
    date,
    weightKg: 80.8,
  })),
  ...["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"].map((date) => ({
    date,
    weightKg: 80.2,
  })),
  { date: "2026-10-05", weightKg: 80 },
  { date: "2026-10-06", weightKg: 79.9 },
];

const PROGRAM_TABLES = {
  program: "programs",
  programSession: "programSessions",
  programSlot: "programSlots",
} as const;

// The server refuses whatever the phone sends; with nothing sent, the fake answers as usual. Given
// the fake server, it sends back, as the real one does, the rows it holds for the programs,
// sessions and slots it refused, so a refused field shows the stored value again.
export async function refuseChanges(
  page: Page,
  reason: Rejected["reason"] = "refused",
  server?: { other: ReadonlyMap<string, Row> },
) {
  await page.route("**/api/sync", (route) => {
    const request = route.request().postDataJSON() as SyncRequest;
    if (request.changes.length === 0) return route.fallback();
    const held = (table: (typeof PROGRAM_TABLES)[keyof typeof PROGRAM_TABLES]) => {
      const keys = new Set(
        request.changes.flatMap((c) =>
          c.kind in PROGRAM_TABLES &&
          PROGRAM_TABLES[c.kind as keyof typeof PROGRAM_TABLES] === table &&
          "id" in c
            ? [`${table}|${c.id}`]
            : [],
        ),
      );
      return [...keys].flatMap((key) => {
        const row = server?.other.get(key);
        return row ? [bare(row)] : [];
      });
    };
    return route.fulfill({
      json: {
        cursor: request.cursor,
        weights: [],
        measures: [],
        intake: [],
        supplements: [],
        supplementLogs: [],
        annotations: [],
        steps: [],
        activities: [],
        workouts: [],
        sets: [],
        target: null,
        profile: null,
        programs: held("programs"),
        programSessions: held("programSessions"),
        programSlots: held("programSlots"),
        rejected: request.changes.map((_, index) => ({ index, reason })),
        hasMore: false,
      },
    });
  });
}
