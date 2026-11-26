import { describe, expect, it } from "vitest";
import { sessionByCode, starterProgram } from "../../training/program";
import type { ExportRows } from "./changes";
import { type ExportFile, exportFileName, readExportFile } from "./format";

const T = (m: number) => new Date(Date.UTC(2026, 10, 20, 7, m)).toISOString();
const W = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90";
const SET = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d91";

const rows = (): ExportRows => ({
  weights: [{ date: "2026-11-20", weightKg: 80.4, at: T(1) }],
  measures: [],
  intake: [],
  supplements: [],
  supplementLogs: [],
  annotations: [],
  steps: [],
  activities: [],
  workouts: [],
  sets: [],
  programs: [],
  programSessions: [],
  programSlots: [],
  activeProgram: null,
  target: null,
  profile: null,
});

const file = (): ExportFile => ({
  format: "belay-export",
  version: 1,
  exportedAt: T(30),
  app: { platform: "web", version: "1.4.0" },
  source: { kind: "local", id: W },
  lastSync: null,
  rows: { ...rows(), efforts: [{ workoutId: W, floor: 7 }] },
});

describe("the export file", () => {
  it("reads back what it writes", () => {
    const f = file();
    expect(readExportFile(JSON.stringify(f))).toEqual({ ok: true, file: f });
    const signedIn: ExportFile = {
      ...f,
      source: { kind: "instance", origin: "https://belay.example", account: SET },
      lastSync: T(29),
      rows: rows(),
    };
    expect(readExportFile(JSON.stringify(signedIn))).toEqual({ ok: true, file: signedIn });
  });

  it("refuses a file that is no Belay export", () => {
    for (const text of ["", "pas du json", "null", "[]", '{"format":"other","version":1}'])
      expect(readExportFile(text)).toEqual({ ok: false, reason: "not_belay" });
    expect(readExportFile(JSON.stringify({ ...file(), version: "1" }))).toEqual({
      ok: false,
      reason: "not_belay",
    });
  });

  it("refuses a file whose envelope is no Belay export's", () => {
    for (const broken of [{ app: { platform: "watch", version: "1" } }, { rows: null }])
      expect(readExportFile(JSON.stringify({ ...file(), ...broken }))).toEqual({
        ok: false,
        reason: "not_belay",
      });
  });

  it("refuses a file of a later version", () => {
    expect(readExportFile(JSON.stringify({ ...file(), version: 2 }))).toEqual({
      ok: false,
      reason: "later_version",
    });
  });

  it("refuses a file with a refused row, naming its kind and date", () => {
    // Out of the row schema.
    const shape = file();
    shape.rows.weights.push({ date: "2026-11-21", weightKg: "lourd" as never, at: T(2) });
    expect(readExportFile(JSON.stringify(shape))).toEqual({
      ok: false,
      reason: "refused",
      kind: "weights",
      date: "2026-11-21",
    });
    // A row the contract refuses once made a change: 5 kg is no weigh-in.
    const bound = file();
    bound.rows.weights.push({ date: "2026-11-22", weightKg: 5, at: T(2) });
    expect(readExportFile(JSON.stringify(bound))).toEqual({
      ok: false,
      reason: "refused",
      kind: "weights",
      date: "2026-11-22",
    });
    // A set takes its session's day.
    const set = file();
    set.rows.workouts.push({
      id: W,
      sessionCode: "A",
      plan: [...sessionByCode("A", starterProgram)!.slots],
      planAt: null,
      startedAt: T(10),
      startedAtAt: null,
      endedAt: null,
      endedAtAt: null,
      note: null,
      noteAt: null,
      exerciseNotes: {},
      exerciseNotesAt: null,
      removed: false,
      removedAt: null,
    });
    set.rows.sets.push({
      id: SET,
      workoutId: W,
      slotIndex: 0,
      position: 0,
      exerciseId: "nope",
      warmup: false,
      weightKg: 60,
      reps: 8,
      seconds: null,
      rir: 2,
      doneAt: T(11),
      fieldsAt: T(11),
      removed: false,
      removedAt: null,
    });
    const refused = readExportFile(JSON.stringify(set));
    expect(refused).toEqual({ ok: false, reason: "refused", kind: "sets", date: "2026-11-20" });
    // A row that is no record at all.
    const odd = { ...file(), rows: { ...rows(), weights: [5] } };
    expect(readExportFile(JSON.stringify(odd))).toEqual({
      ok: false,
      reason: "refused",
      kind: "weights",
    });
    // A row with no day of its own names its kind alone.
    const target = file();
    target.rows.target = { minPct: 2, maxPct: 1, at: T(3) };
    expect(readExportFile(JSON.stringify(target))).toEqual({
      ok: false,
      reason: "refused",
      kind: "target",
    });
  });

  it("takes session times a little ahead of their write time, as the server keeps them", () => {
    const f = file();
    const at = (ms: number) => new Date(Date.UTC(2026, 10, 20, 7, 10) + ms).toISOString();
    f.rows.workouts.push({
      id: W,
      sessionCode: "A",
      plan: [...sessionByCode("A", starterProgram)!.slots],
      planAt: null,
      startedAt: at(1_000),
      startedAtAt: at(0),
      endedAt: at(60_000),
      endedAtAt: at(30_000),
      note: null,
      noteAt: null,
      exerciseNotes: {},
      exerciseNotesAt: null,
      removed: false,
      removedAt: null,
    });
    f.rows.sets.push({
      id: SET,
      workoutId: W,
      slotIndex: 0,
      position: 3,
      exerciseId: sessionByCode("A", starterProgram)!.slots[0]!.exerciseId,
      warmup: false,
      weightKg: 60,
      reps: 8,
      seconds: null,
      rir: 2,
      doneAt: at(2_000),
      fieldsAt: at(0),
      removed: false,
      removedAt: null,
    });
    expect(readExportFile(JSON.stringify(f))).toEqual({ ok: true, file: f });
    // Past the server's slack, still refused.
    f.rows.sets[0]!.doneAt = at(5 * 60_000 + 1);
    expect(readExportFile(JSON.stringify(f))).toMatchObject({ ok: false, kind: "sets" });
  });

  it("names the file in plain words in each language", () => {
    const day = new Date(Date.UTC(2026, 10, 26, 12));
    expect(exportFileName(day, "fr")).toBe("Belay — tes données — 26 nov. 2026.json");
    expect(exportFileName(day, "en")).toBe("Belay — your data — 26 Nov 2026.json");
  });
});
