import { CONSENT_VERSION, MAX_BODY_BYTES, MAX_CHANGES } from "@belay/shared/sync/limits";
import { SyncRequestSchema } from "@belay/shared/sync/schema";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { requireUser, type AuthEnv } from "../auth/session";
import type { Config } from "../config";
import { asUser, type Db } from "../db/client";
import { users } from "../db/schema";
import { runSync } from "./sync";

const tooLarge = { error: "too_large" } as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const consentAt = z.iso.datetime();

async function consented(db: Db, userId: string, version: number): Promise<boolean> {
  const rows = await asUser(db, userId, (tx) =>
    tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.consentVersion, version))),
  );
  return rows.length === 1;
}

// The notice's current version is the shared constant; a test may raise it to ask everyone again.
export function apiRoutes(cfg: Config, db: Db, consentVersion: number = CONSENT_VERSION) {
  const api = new Hono<AuthEnv>();
  api.use("*", requireUser(cfg, db));

  api.get("/me", async (c) => {
    const userId = c.get("userId");
    // Explicit filter first, row-level security second: neither barrier is relied on alone.
    const [me] = await asUser(db, userId, (tx) =>
      tx
        .select({
          id: users.id,
          displayName: users.displayName,
          consentVersion: users.consentVersion,
          consentAt: users.consentAt,
        })
        .from(users)
        .where(eq(users.id, userId)),
    );
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    // Only whether loops exist, never where they live.
    return c.json({
      id: me.id,
      displayName: me.displayName,
      media: cfg.mediaDir !== undefined,
      consent:
        me.consentVersion === null || me.consentAt === null
          ? null
          : { version: me.consentVersion, at: me.consentAt.toISOString() },
      consentVersion,
    });
  });

  // The person agrees to this instance's current notice; an older version is not the one shown.
  // The time is the device's, brought within the last day and never past the server's clock.
  api.post(
    "/consent",
    bodyLimit({ maxSize: 1024, onError: (c) => c.json(tooLarge, 413) }),
    async (c) => {
      const body = (await c.req.json().catch(() => undefined)) as
        { version?: unknown; at?: unknown } | undefined;
      if (body?.version !== consentVersion) return c.json({ error: "consent_version" }, 409);
      const at = consentAt.safeParse(body.at);
      if (!at.success) return c.json({ error: "invalid" }, 400);
      const now = Date.now();
      const kept = new Date(Math.min(now, Math.max(now - DAY_MS, Date.parse(at.data))));
      const userId = c.get("userId");
      await asUser(db, userId, (tx) =>
        tx
          .update(users)
          .set({ consentVersion, consentAt: kept })
          // The first record of a version stands; a consent to any other version is replaced.
          .where(
            and(
              eq(users.id, userId),
              or(isNull(users.consentVersion), ne(users.consentVersion, consentVersion)),
            ),
          ),
      );
      return c.body(null, 204);
    },
  );

  // The whole batch or nothing: an invalid change refuses the batch before anything is written.
  api.post(
    "/sync",
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json(tooLarge, 413) }),
    async (c) => {
      const body: unknown = await c.req.json().catch(() => undefined);
      const changes = (body as { changes?: unknown } | undefined)?.changes;
      if (Array.isArray(changes) && changes.length > MAX_CHANGES) return c.json(tooLarge, 413);
      // Nothing of the person's reaches this instance before they agreed to its current notice.
      if (!(await consented(db, c.get("userId"), consentVersion)))
        return c.json({ error: "consent_required" }, 403);
      const parsed = SyncRequestSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: "invalid" }, 400);
      // A queue from another account on this browser: nothing of it may land in this one.
      if (parsed.data.account !== c.get("userId")) return c.json({ error: "wrong_account" }, 409);
      return c.json(await runSync(db, c.get("userId"), parsed.data));
    },
  );

  return api;
}
