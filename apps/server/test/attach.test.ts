import { newId } from "@belay/shared";
import { MAX_BODY_BYTES } from "@belay/shared/sync/limits";
import type { Change, SyncResponse } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { createSession, upsertUser } from "../src/db/identity";
import { testEnv } from "./config";
import { agree, appDb } from "./db";

const { db } = appDb();
const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });
const PLAN = [...sessionByCode("B", starterProgram)!.slots];
const EARLY = "2026-11-01T07:00:00.000Z";
const LATE = "2026-11-02T07:00:00.000Z";

async function signIn(sub: string) {
  const issuer = "https://idp.test";
  const user = await upsertUser(db, { issuer, sub, displayName: sub });
  await agree(db, user);
  const token = newSessionToken();
  await createSession(db, hashToken(token, cfg.tokenHashKey), { id: user, issuer, sub }, 30);
  const raw = (body: string) =>
    app.request("/api/sync", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    });
  const sync = async (changes: Change[], cursor = "0") => {
    const res = await raw(JSON.stringify({ account: user, cursor, changes }));
    return (await res.json()) as SyncResponse;
  };
  return { user, raw, sync };
}
const start = (id = newId()): Change => ({
  kind: "workout",
  id,
  field: "start",
  sessionCode: "B",
  plan: PLAN,
  startedAt: EARLY,
  at: EARLY,
});

describe("the request size limit", () => {
  it("takes a request of exactly 256 KiB and refuses one byte more with 413", async () => {
    const { user, raw } = await signIn("limit-exact");
    const json = JSON.stringify({ account: user, cursor: "0", changes: [start(), start()] });
    const exact = json + " ".repeat(MAX_BODY_BYTES - new TextEncoder().encode(json).length);
    expect((await raw(exact)).status).toBe(200);
    expect((await raw(`${exact} `)).status).toBe(413);
  });
});

describe("a device's data sent into an account", () => {
  it("gives the same rows when the same changes arrive twice", async () => {
    const { sync } = await signIn("attach-twice");
    const changes = [
      start(),
      { kind: "weight", date: "2026-11-01", weightKg: 80, at: EARLY },
    ] satisfies Change[];
    await sync(changes);
    const once = await sync([]);
    // A replayed start loses to the stored one and comes back as it is: nothing new is written.
    await sync(changes);
    const twice = await sync([]);
    expect(twice.workouts).toEqual(once.workouts);
    expect(twice.weights).toEqual(once.weights);
    expect(twice.cursor).toBe(once.cursor);
  });

  it("holds both devices' sessions once and the latest value of a day written on both", async () => {
    const { sync } = await signIn("attach-two");
    const [a, b] = [newId(), newId()];
    await sync([start(a), { kind: "weight", date: "2026-11-01", weightKg: 81, at: LATE }]);
    await sync([start(b), { kind: "weight", date: "2026-11-01", weightKg: 79, at: EARLY }]);
    const all = await sync([]);
    expect(all.workouts.map((w) => w.id).sort()).toEqual([a, b].sort());
    expect(all.weights).toEqual([{ date: "2026-11-01", weightKg: 81, at: LATE }]);
  });

  it("keeps the creatine flag of an imported supplement when the change creates it, and ignores it on a rename", async () => {
    const { sync } = await signIn("attach-creatine");
    const [renamed, plain] = [newId(), newId()];
    await sync([
      {
        kind: "supplement",
        id: renamed,
        field: "name",
        value: "Magnésium",
        creatine: true,
        at: EARLY,
      },
      {
        kind: "supplement",
        id: plain,
        field: "name",
        value: "Créatine",
        creatine: false,
        at: EARLY,
      },
    ]);
    // On a row that exists already, the flag is ignored: the stored kind stays.
    await sync([
      { kind: "supplement", id: plain, field: "name", value: "Zinc", creatine: true, at: LATE },
    ]);
    const kinds = Object.fromEntries(
      (await sync([])).supplements.map((s) => [s.id, [s.name, s.kind]]),
    );
    expect(kinds[renamed]).toEqual(["Magnésium", "creatine"]);
    expect(kinds[plain]).toEqual(["Zinc", "other"]);
  });
});
