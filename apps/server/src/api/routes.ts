import { MAX_BODY_BYTES, MAX_CHANGES } from "@belay/shared/sync/limits";
import { SyncRequestSchema } from "@belay/shared/sync/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireUser, type AuthEnv } from "../auth/session";
import type { Config } from "../config";
import { asUser, type Db } from "../db/client";
import { users } from "../db/schema";
import { runSync } from "./sync";

const tooLarge = { error: "too_large" } as const;

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
    return me ? c.json(me) : c.json({ error: "unauthenticated" }, 401);
  });

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
