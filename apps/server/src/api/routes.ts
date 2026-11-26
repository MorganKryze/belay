import { CONSENT_VERSION, MAX_BODY_BYTES, MAX_CHANGES } from "@belay/shared/sync/limits";
import { SyncRequestSchema } from "@belay/shared/sync/schema";
import { eq } from "drizzle-orm";
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

export function apiRoutes(cfg: Config, db: Db) {
  const api = new Hono<AuthEnv>();
  api.use("*", requireUser(cfg, db));

  api.get("/me", async (c) => {
    const userId = c.get("userId");
    // Explicit filter first, row-level security second: neither barrier is relied on alone.
    const [me] = await asUser(db, userId, (tx) =>
      tx
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, userId)),
    );
    // Only whether loops exist, never where they live.
    return me
      ? c.json({ ...me, media: cfg.mediaDir !== undefined })
      : c.json({ error: "unauthenticated" }, 401);
  });

  // The person agrees to this instance's current notice; an older version is not the one shown.
  // The time is the device's, brought within the last day and never past the server's clock.
  api.post(
    "/consent",
    bodyLimit({ maxSize: 1024, onError: (c) => c.json(tooLarge, 413) }),
    async (c) => {
      const body = (await c.req.json().catch(() => undefined)) as
        { version?: unknown; at?: unknown } | undefined;
      if (body?.version !== CONSENT_VERSION) return c.json({ error: "consent_version" }, 409);
      const at = consentAt.safeParse(body.at);
      if (!at.success) return c.json({ error: "invalid" }, 400);
      const now = Date.now();
      const kept = new Date(Math.min(now, Math.max(now - DAY_MS, Date.parse(at.data))));
      const userId = c.get("userId");
      await asUser(db, userId, (tx) =>
        tx
          .update(users)
          .set({ consentVersion: CONSENT_VERSION, consentAt: kept })
          .where(eq(users.id, userId)),
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
      const parsed = SyncRequestSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: "invalid" }, 400);
      // A queue from another account on this browser: nothing of it may land in this one.
      if (parsed.data.account !== c.get("userId")) return c.json({ error: "wrong_account" }, 409);
      return c.json(await runSync(db, c.get("userId"), parsed.data));
    },
  );

  return api;
}
