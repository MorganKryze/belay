import { newId } from "@belay/shared";
import type { Change, SyncResponse } from "@belay/shared/sync/schema";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken, SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { createSession, upsertUser } from "../src/db/identity";
import { bodyMetrics, intakeLogs, supplements } from "../src/db/schema";
import { testEnv } from "./config";
import { appDb, testDb } from "./db";

// The server as it runs: the belay_app login role, row-level security on every request. The
// owner only arranges rows.
const { db } = appDb();
const owner = testDb().db;
const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });

const AT = "2026-10-07T06:30:00.000Z";
const LATER = "2026-10-07T06:31:00.000Z";
const LATEST = "2026-10-07T06:32:00.000Z";

async function signIn(sub: string) {
  const user = await upsertUser(db, { issuer: "https://idp.test", sub, displayName: sub });
  const token = newSessionToken();
  await createSession(db, hashToken(token, cfg.tokenHashKey), user, 30);
  const cookie = `${SESSION_COOKIE}=${token}`;
  const sync = async (cursor: string, changes: Change[] = []) => {
    const res = await app.request("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ account: user, cursor, changes }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as SyncResponse;
  };
  return { user, sync };
}

const measure = (
  date: string,
  field: "waist" | "neck" | "hip",
  value: number | null,
  at = AT,
): Change => ({
  kind: "measure",
  date,
  field,
  value,
  at,
});
const intake = (
  date: string,
  field: "kcal" | "protein",
  value: number | null,
  at = AT,
): Change => ({
  kind: "intake",
  date,
  field,
  value,
  at,
});
const named = (id: string, value: string, at = AT): Change => ({
  kind: "supplement",
  id,
  field: "name",
  value,
  at,
});
const removed = (id: string, at = LATER): Change => ({
  kind: "supplement",
  id,
  field: "removed",
  value: true,
  at,
});
const tick = (supplementId: string, date: string, taken = true, at = AT): Change => ({
  kind: "supplementLog",
  supplementId,
  date,
  taken,
  at,
});
const note = (id: string, date: string, label: string | null, at = AT): Change => ({
  kind: "annotation",
  id,
  field: "fields",
  date,
  type: "note",
  label,
  at,
});

describe("measurements", () => {
  it("share the day's row with the weigh-in, field by field", async () => {
    const { user, sync } = await signIn("tk-measures");
    const res = await sync("0", [
      { kind: "weight", date: "2026-10-06", weightKg: 80, at: AT },
      measure("2026-10-06", "waist", 82, AT),
      measure("2026-10-06", "neck", 39, LATER),
      measure("2026-10-05", "hip", 98.5, AT),
    ]);
    expect(res.weights).toEqual([{ date: "2026-10-06", weightKg: 80, at: AT }]); // not the 5th
    expect(res.measures).toEqual(
      expect.arrayContaining([
        {
          date: "2026-10-06",
          waistCm: 82,
          waistAt: AT,
          neckCm: 39,
          neckAt: LATER,
          hipCm: null,
          hipAt: null,
        },
        {
          date: "2026-10-05",
          waistCm: null,
          waistAt: null,
          neckCm: null,
          neckAt: null,
          hipCm: 98.5,
          hipAt: AT,
        },
      ]),
    );
    const rows = await owner.select().from(bodyMetrics).where(eq(bodyMetrics.userId, user));
    expect(rows).toHaveLength(2);
  });

  it("let the later write of each one win, and a null delete it", async () => {
    const { sync } = await signIn("tk-measures-lww");
    const first = await sync("0", [measure("2026-10-06", "waist", 82, LATER)]);
    const older = await sync(first.cursor, [
      measure("2026-10-06", "waist", 83, AT), // loses: sent back
      measure("2026-10-06", "neck", 39, AT), // another field: wins
    ]);
    expect(older.measures).toEqual([
      {
        date: "2026-10-06",
        waistCm: 82,
        waistAt: LATER,
        neckCm: 39,
        neckAt: AT,
        hipCm: null,
        hipAt: null,
      },
    ]);
    const gone = await sync(older.cursor, [measure("2026-10-06", "waist", null, LATEST)]);
    expect(gone.measures[0]).toMatchObject({ waistCm: null, waistAt: LATEST, neckCm: 39 });
  });
});

describe("intake", () => {
  it("keeps calories and protein apart, one row per day for two devices", async () => {
    const { user, sync } = await signIn("tk-intake");
    await sync("0", [intake("2026-10-07", "kcal", 2100, AT)]);
    const laptop = await sync("0", [intake("2026-10-07", "protein", 140, LATER)]);
    expect(laptop.intake).toEqual([
      { date: "2026-10-07", kcal: 2100, kcalAt: AT, proteinG: 140, proteinAt: LATER },
    ]);
    const lost = await sync(laptop.cursor, [intake("2026-10-07", "protein", 120, AT)]);
    expect(lost.intake[0]).toMatchObject({ proteinG: 140 }); // sent back, past the cursor
    expect(await owner.select().from(intakeLogs).where(eq(intakeLogs.userId, user))).toHaveLength(
      1,
    );
  });
});

describe("the profile", () => {
  it("syncs each fact under its own timestamp, and clears one with null", async () => {
    const { sync } = await signIn("tk-profile");
    const first = await sync("0", [
      { kind: "profile", field: "formula", value: "male", at: AT },
      { kind: "profile", field: "birthYear", value: 1995, at: AT },
      { kind: "profile", field: "height", value: 178, at: AT },
    ]);
    expect(first.profile).toEqual({
      formula: "male",
      formulaAt: AT,
      birthYear: 1995,
      birthYearAt: AT,
      heightCm: 178,
      heightAt: AT,
    });
    const second = await sync(first.cursor, [
      { kind: "profile", field: "height", value: null, at: LATER },
      { kind: "profile", field: "formula", value: "female", at: "2026-10-07T06:00:00.000Z" }, // older
    ]);
    expect(second.profile).toMatchObject({ formula: "male", heightCm: null, heightAt: LATER });
  });
});

describe("supplements", () => {
  it("takes its kind from the first name it receives, never from a later rename", async () => {
    const { sync } = await signIn("tk-kind");
    const [creatine, vitamin] = [newId(), newId()];
    const res = await sync("0", [
      named(creatine, "Créatine"),
      named(creatine, "Créa", LATER), // renamed in the same batch
      named(vitamin, "Vitamine D"),
    ]);
    expect(res.supplements).toEqual(
      expect.arrayContaining([
        {
          id: creatine,
          name: "Créa",
          nameAt: LATER,
          kind: "creatine",
          removed: false,
          removedAt: null,
        },
        {
          id: vitamin,
          name: "Vitamine D",
          nameAt: AT,
          kind: "other",
          removed: false,
          removedAt: null,
        },
      ]),
    );
    const renamed = await sync(res.cursor, [named(vitamin, "Créatine", LATEST)]);
    expect(renamed.supplements[0]).toMatchObject({ name: "Créatine", kind: "other" });
  });

  it("is removed, never deleted, and keeps its ticked days", async () => {
    const { sync } = await signIn("tk-remove");
    const id = newId();
    const first = await sync("0", [named(id, "Créatine"), tick(id, "2026-10-06")]);
    const gone = await sync(first.cursor, [removed(id)]);
    expect(gone.supplements[0]).toMatchObject({ id, removed: true, removedAt: LATER });
    const all = await sync("0");
    expect(all.supplementLogs).toEqual([
      { supplementId: id, date: "2026-10-06", taken: true, at: AT },
    ]);
  });

  it("refuses, alone, a change naming a supplement the account does not have", async () => {
    const a = await signIn("tk-unknown-a");
    const b = await signIn("tk-unknown-b");
    const mine = newId();
    await a.sync("0", [named(mine, "Fer")]);
    const res = await b.sync("0", [
      named(newId(), "Zinc"),
      named(mine, "Pirate"), // A's id
      removed(newId()), // never created
      tick(mine, "2026-10-07"), // A's supplement
      tick(newId(), "2026-10-07"), // nobody's
    ]);
    expect(res.rejected).toEqual([
      { index: 1, reason: "unknown" },
      { index: 2, reason: "unknown" },
      { index: 3, reason: "unknown" },
      { index: 4, reason: "unknown" },
    ]);
    expect(res.supplements.map((s) => s.name)).toEqual(["Zinc"]);
    const [kept] = await owner.select().from(supplements).where(eq(supplements.id, mine));
    expect(kept).toMatchObject({ name: "Fer", userId: a.user });
  });
});

describe("supplement ticks", () => {
  it("keeps a tick made offline on a supplement removed elsewhere meanwhile, and sends the removal", async () => {
    const { sync } = await signIn("tk-removed-ticked");
    const id = newId();
    const start = await sync("0", [named(id, "Créatine")]);
    await sync(start.cursor, [removed(id, LATER)]); // the laptop removes it
    // The phone, offline since 6:30, ticked it at 6:32 and syncs from its old cursor.
    const phone = await sync(start.cursor, [tick(id, "2026-10-07", true, LATEST)]);
    expect(phone.rejected).toEqual([]);
    expect(phone.supplementLogs).toEqual([
      { supplementId: id, date: "2026-10-07", taken: true, at: LATEST },
    ]);
    expect(phone.supplements).toEqual([expect.objectContaining({ id, removed: true })]);
  });

  it("tick and untick a day, the later write winning, with the supplement of the same batch", async () => {
    const { sync } = await signIn("tk-ticks");
    const id = newId();
    const first = await sync("0", [named(id, "Créatine"), tick(id, "2026-10-07", true, AT)]);
    expect(first.supplementLogs).toEqual([
      { supplementId: id, date: "2026-10-07", taken: true, at: AT },
    ]);
    const off = await sync(first.cursor, [tick(id, "2026-10-07", false, LATER)]);
    expect(off.supplementLogs).toEqual([
      { supplementId: id, date: "2026-10-07", taken: false, at: LATER },
    ]);
    const late = await sync(off.cursor, [tick(id, "2026-10-07", true, AT)]); // offline since 6:30
    expect(late.supplementLogs).toEqual([
      { supplementId: id, date: "2026-10-07", taken: false, at: LATER },
    ]);
  });
});

describe("annotations", () => {
  it("are written as one block, edited, then removed for good", async () => {
    const { sync } = await signIn("tk-notes");
    const id = newId();
    const first = await sync("0", [note(id, "2026-09-15", "voyage")]);
    expect(first.annotations).toEqual([
      {
        id,
        date: "2026-09-15",
        type: "note",
        label: "voyage",
        fieldsAt: AT,
        removed: false,
        removedAt: null,
      },
    ]);
    const gone = await sync(first.cursor, [
      { kind: "annotation", id, field: "removed", value: true, at: LATEST },
    ]);
    expect(gone.annotations[0]).toMatchObject({ removed: true, removedAt: LATEST });
    // A phone offline since before the removal edits the text: it shows, still removed.
    const edit = await sync(gone.cursor, [note(id, "2026-09-16", "vacances", LATER)]);
    expect(edit.annotations[0]).toMatchObject({
      label: "vacances",
      date: "2026-09-16",
      removed: true,
    });
  });

  it("refuse a removal of an annotation the account does not have", async () => {
    const { sync } = await signIn("tk-notes-unknown");
    const res = await sync("0", [
      { kind: "annotation", id: newId(), field: "removed", value: true, at: AT },
    ]);
    expect(res.rejected).toEqual([{ index: 0, reason: "unknown" }]);
  });
});

describe("two accounts", () => {
  it("never see or touch each other's rows, whatever the table", async () => {
    const a = await signIn("tk-iso-a");
    const b = await signIn("tk-iso-b");
    const id = newId();
    await a.sync("0", [
      measure("2026-10-06", "waist", 82),
      intake("2026-10-07", "kcal", 2100),
      { kind: "profile", field: "height", value: 178, at: AT },
      named(id, "Créatine"),
      tick(id, "2026-10-07"),
      note(newId(), "2026-09-15", "voyage"),
    ]);
    const seen = await b.sync("0", [intake("2026-10-07", "kcal", 1500, LATER)]);
    expect(seen.measures).toEqual([]);
    expect(seen.intake).toEqual([
      { date: "2026-10-07", kcal: 1500, kcalAt: LATER, proteinG: null, proteinAt: null },
    ]);
    expect(seen.supplements).toEqual([]);
    expect(seen.supplementLogs).toEqual([]);
    expect(seen.annotations).toEqual([]);
    expect(seen.profile).toMatchObject({ heightCm: null });
    const again = await a.sync("0");
    expect(again.intake[0]).toMatchObject({ kcal: 2100 });
  });
});

describe("a replay and the pages", () => {
  it("changes neither the data nor the cursor when a mixed batch is replayed", async () => {
    const { sync } = await signIn("tk-replay");
    const id = newId();
    const batch = [
      measure("2026-10-06", "waist", 82),
      intake("2026-10-07", "kcal", 2100),
      { kind: "profile", field: "formula", value: "female", at: AT } as Change,
      named(id, "Créatine"),
      tick(id, "2026-10-07"),
      note(newId(), "2026-09-15", null),
    ];
    const first = await sync("0", batch);
    const replay = await sync(first.cursor, batch);
    expect(replay).toEqual({
      cursor: first.cursor,
      weights: [],
      measures: [],
      intake: [],
      supplements: [],
      supplementLogs: [],
      annotations: [],
      target: null,
      profile: null,
      rejected: [],
      hasMore: false,
    });
  });

  it("pages across tables in sequence order, 1 000 rows at a time", async () => {
    const { user, sync } = await signIn("tk-pages");
    const start = await sync("0");
    const day = (i: number) =>
      new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    await owner.insert(intakeLogs).values(
      Array.from({ length: 600 }, (_, i) => ({
        userId: user,
        date: day(i),
        kcal: 2000,
        kcalAt: new Date(AT),
      })),
    );
    await owner.insert(bodyMetrics).values(
      Array.from({ length: 600 }, (_, i) => ({
        userId: user,
        date: day(i),
        waistCm: 82,
        waistAt: new Date(AT),
      })),
    );
    const page1 = await sync(start.cursor);
    expect(page1.intake.length + page1.measures.length).toBe(1000);
    expect(page1.intake).toHaveLength(600); // written first, sent first
    expect(page1.hasMore).toBe(true);
    const page2 = await sync(page1.cursor);
    expect(page2.measures).toHaveLength(200);
    expect(page2.hasMore).toBe(false);
  });
});
