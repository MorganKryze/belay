import { constants, promises as fsp } from "node:fs";
import { join, sep } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { requireUser, type AuthEnv } from "./auth/session";
import type { Config } from "./config";
import type { Db } from "./db/client";

// Four ASCII digits, checked before any path is built: nothing else from the URL reaches the disk.
export const MEDIA_ID = /^\d{4}$/;
// A loop weighs about 100 KB; the cap bounds what a misplaced file in the directory could cost.
export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
// 30 days, revalidated by ETag.
export const MEDIA_CACHE_CONTROL = "private, max-age=2592000";

const notFound = { error: "not_found" } as const;

// A refusal (401, 404, 416) is never kept by a browser or a proxy; a loop is.
const refusalsNoStore: MiddlewareHandler = async (c, next) => {
  await next();
  if (![200, 206, 304].includes(c.res.status)) c.header("Cache-Control", "no-store");
};

// If-None-Match is a list of tags, or `*`; a weak tag compares by its value.
function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

export function mediaRoutes(cfg: Config, db: Db) {
  const media = new Hono<AuthEnv>();
  media.use("*", refusalsNoStore);
  // Before any id or file-system work, so a stranger learns nothing about which loops exist.
  media.use("*", requireUser(cfg, db));

  media.get("/exercises/:id", async (c, next) => {
    const id = c.req.param("id");
    const dir = cfg.mediaDir;
    if (!dir || !MEDIA_ID.test(id)) return c.json(notFound, 404);
    // Containment on the real path: a link leading out of the directory is refused.
    const real = await fsp.realpath(join(dir, `${id}.mp4`)).catch(() => null);
    // An .mp4 target only: serveStatic types the reply from the real file's extension.
    if (!real?.startsWith(dir + sep) || !real.endsWith(".mp4")) return c.json(notFound, 404);
    const st = await fsp.stat(real).catch(() => null);
    // Regular files only: opening a FIFO would block the read forever.
    if (!st?.isFile() || st.size > MEDIA_MAX_BYTES) return c.json(notFound, 404);
    // Readable before the 200 goes out, or the reply would be cut short and cached for a month.
    if (
      !(await fsp.access(real, constants.R_OK).then(
        () => true,
        () => false,
      ))
    )
      return c.json(notFound, 404);

    // Only computed values go into headers, never anything the request sent.
    const etag = `"${st.size.toString(16)}-${Math.trunc(st.mtimeMs).toString(16)}"`;
    c.header("ETag", etag);
    c.header("Cache-Control", MEDIA_CACHE_CONTROL);
    c.header("Accept-Ranges", "bytes");
    if (matches(c.req.header("If-None-Match"), etag)) return c.body(null, 304);
    // Streams the file and answers ranges (206, 416) with Content-Type and Last-Modified.
    return serveStatic({ path: real })(c, next);
  });

  return media;
}
