import { Hono } from "hono";
import { requireUser, type AuthEnv } from "../auth/session";
import type { Config } from "../config";
import { asUser, type Db } from "../db/client";
import { users } from "../db/schema";

export function apiRoutes(cfg: Config, db: Db) {
  const api = new Hono<AuthEnv>();
  api.use("*", requireUser(cfg, db));

  api.get("/me", async (c) => {
    const [me] = await asUser(db, c.get("userId"), (tx) =>
      tx.select({ id: users.id, displayName: users.displayName }).from(users),
    );
    return me ? c.json(me) : c.json({ error: "unauthenticated" }, 401);
  });

  return api;
}
