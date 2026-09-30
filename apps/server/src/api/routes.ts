import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireUser, type AuthEnv } from "../auth/session";
import type { Config } from "../config";
import { asUser, type Db } from "../db/client";
import { users } from "../db/schema";

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

  return api;
}
