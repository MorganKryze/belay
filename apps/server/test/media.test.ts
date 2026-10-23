import { execFileSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  promises as fsp,
  statSync,
  chmodSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken, SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { createSession, upsertUser } from "../src/db/identity";
import { testEnv } from "./config";
import { testDb } from "./db";

const { db } = testDb();

const dist = mkdtempSync(join(tmpdir(), "belay-web-"));
writeFileSync(join(dist, "index.html"), "<!doctype html><title>Belay</title>");

// Synthetic bytes only: a loop is any file named <four digits>.mp4 to the server.
const media = mkdtempSync(join(tmpdir(), "belay-media-"));
const outside = mkdtempSync(join(tmpdir(), "belay-outside-"));
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
writeFileSync(join(media, "0001.mp4"), bytes);
writeFileSync(join(outside, "secret.mp4"), "outside the media directory");
symlinkSync(join(outside, "secret.mp4"), join(media, "0002.mp4"));
mkdirSync(join(media, "0003.mp4"));
let hasFifo = true;
try {
  execFileSync("mkfifo", [join(media, "0004.mp4")]);
} catch {
  hasFifo = false;
}
const big = openSync(join(media, "0005.mp4"), "w");
closeSync(big);
await fsp.truncate(join(media, "0005.mp4"), 9 * 1024 * 1024);
symlinkSync(join(media, "0001.mp4"), join(media, "0006.mp4"));
// A link inside the directory to a page, and a loop the server cannot read.
writeFileSync(join(media, "page.html"), "<script>alert(1)</script>");
symlinkSync(join(media, "page.html"), join(media, "0007.mp4"));
writeFileSync(join(media, "0008.mp4"), bytes);
chmodSync(join(media, "0008.mp4"), 0o000);
const asRoot = process.getuid?.() === 0; // root reads a mode-000 file anyway

const st = statSync(join(media, "0001.mp4"));
const etag = `"${st.size.toString(16)}-${Math.trunc(st.mtimeMs).toString(16)}"`;

const build = (overrides: Record<string, string> = {}) => {
  const cfg = loadConfig(
    testEnv({
      OIDC_ISSUER: "http://localhost:1",
      WEB_DIST: relative(process.cwd(), dist),
      ...overrides,
    }),
  );
  return { cfg, app: createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) }) };
};
const { cfg, app } = build({ BELAY_MEDIA_DIR: media });
const { app: off } = build();

let n = 0;
async function signedIn() {
  const user = await upsertUser(db, {
    issuer: "https://idp.test",
    sub: `media-${++n}`,
    displayName: "Ada",
  });
  const token = newSessionToken();
  await createSession(db, hashToken(token, cfg.tokenHashKey), user, 30);
  return `${SESSION_COOKIE}=${token}`;
}

const get = async (path: string, headers: Record<string, string> = {}, target = app) =>
  target.request(path, { headers: { cookie: await signedIn(), ...headers } });

afterEach(() => vi.restoreAllMocks());

describe("GET /media/exercises/:id", () => {
  it("answers 401 without a session, for a valid and an invalid id alike, with no-store", async () => {
    for (const path of [
      "/media/exercises/0001",
      "/media/exercises/nope",
      "/media/exercises/9999",
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(401);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      expect(res.headers.get("etag"), path).toBeNull();
      expect(await res.json()).toEqual({ error: "unauthenticated" });
    }
  });

  it("tells a stranger nothing: without a session, an instance with media answers exactly like one without", async () => {
    const strip = (h: Headers) => [...h].filter(([k]) => k !== "date").sort();
    for (const path of [
      "/media/exercises/0001",
      "/media/exercises/9999",
      "/media/exercises/nope",
    ]) {
      for (const init of [{}, { method: "HEAD" }, { headers: { range: "bytes=0-9" } }]) {
        const [on, none] = await Promise.all([app.request(path, init), off.request(path, init)]);
        expect(on.status, path).toBe(none.status);
        expect(strip(on.headers), path).toEqual(strip(none.headers));
        expect(await on.text(), path).toBe(await none.text());
      }
    }
  });

  it("answers 404 to an id that is not four ASCII digits", async () => {
    const realpath = vi.spyOn(fsp, "realpath");
    const stat = vi.spyOn(fsp, "stat");
    for (const id of [
      "..",
      "%2e%2e%2f",
      "..%2F0001",
      "0001.mp4",
      "00001",
      "001",
      "0001%00",
      encodeURIComponent("١٢٣٤"),
      "",
    ]) {
      const res = await get(`/media/exercises/${id}`);
      expect(res.status, id).toBe(404);
      expect(res.headers.get("cache-control"), id).toBe("no-store");
      expect(await res.text(), id).not.toContain("<title>");
    }
    expect(realpath).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });

  it("answers 404 when media is off", async () => {
    const realpath = vi.spyOn(fsp, "realpath");
    const res = await get("/media/exercises/0001", {}, off);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(realpath).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing file, a directory, a FIFO, an oversize file, a link that leaves the directory, a link to a non-loop and an unreadable file", async () => {
    const ids = [
      "0009",
      "0003",
      "0005",
      "0002",
      "0007",
      ...(asRoot ? [] : ["0008"]),
      ...(hasFifo ? ["0004"] : []),
    ];
    for (const id of ids) {
      const res = await Promise.race([
        get(`/media/exercises/${id}`),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${id} did not answer within 2 s`)), 2000),
        ),
      ]);
      expect(res.status, id).toBe(404);
      expect(res.headers.get("cache-control"), id).toBe("no-store");
      expect(await res.json(), id).toEqual({ error: "not_found" });
    }
  });

  it("serves a link that stays inside the directory", async () => {
    const res = await get("/media/exercises/0006");
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it("serves the whole loop with its type, length, ETag, Last-Modified, a private 30-day cache, nosniff and same-origin CORP", async () => {
    const res = await get("/media/exercises/0001");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-length")).toBe("1000");
    expect(res.headers.get("etag")).toBe(etag);
    expect(res.headers.get("last-modified")).toBe(st.mtime.toUTCString());
    expect(res.headers.get("cache-control")).toBe("private, max-age=2592000");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it("answers a byte range with 206 and its Content-Range", async () => {
    for (const [range, start, end] of [
      ["bytes=0-1", 0, 1],
      ["bytes=10-", 10, 999],
      ["bytes=-10", 990, 999],
    ] as const) {
      const res = await get("/media/exercises/0001", { range });
      expect(res.status, range).toBe(206);
      expect(res.headers.get("content-range"), range).toBe(`bytes ${start}-${end}/1000`);
      expect(res.headers.get("cache-control"), range).toBe("private, max-age=2592000");
      expect(Buffer.from(await res.arrayBuffer()), range).toEqual(bytes.subarray(start, end + 1));
    }
  });

  it("answers an unsatisfiable range with 416 and bytes */1000", async () => {
    const res = await get("/media/exercises/0001", { range: "bytes=1000-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */1000");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 304 when If-None-Match matches, 200 when it does not", async () => {
    for (const tag of [etag, `W/${etag}`, `"zzz", ${etag}`, "*"]) {
      const res = await get("/media/exercises/0001", { "if-none-match": tag });
      expect(res.status, tag).toBe(304);
      expect(res.headers.get("etag"), tag).toBe(etag);
      expect(res.headers.get("cache-control"), tag).toBe("private, max-age=2592000");
      expect(await res.text(), tag).toBe("");
    }
    const res = await get("/media/exercises/0001", { "if-none-match": '"3e8-0"' });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it("HEAD answers the length without a body", async () => {
    const res = await app.request("/media/exercises/0001", {
      method: "HEAD",
      headers: { cookie: await signedIn() },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("1000");
    expect(res.headers.get("etag")).toBe(etag);
    expect(await res.text()).toBe("");
  });

  it("POST and other paths under /media answer 404 JSON with no-store, never the shell", async () => {
    const cookie = await signedIn();
    const answers = [
      await app.request("/media/exercises/0001", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
      }),
      await app.request("/media/nope", { headers: { cookie } }),
      await app.request("/media/exercises/0001/more", { headers: { cookie } }),
      await app.request("/media/", { headers: { cookie } }),
    ];
    for (const res of answers) {
      expect(res.status, res.url).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("no request header value is echoed in a response header", async () => {
    // Headers refuses CR and LF, so the request carries a raw header list as a proxy might pass it.
    class RawHeaders extends Headers {
      constructor(
        init: HeadersInit,
        private readonly raw: Record<string, string>,
      ) {
        super(init);
      }
      override get(name: string) {
        return this.raw[name.toLowerCase()] ?? super.get(name);
      }
    }
    const cookie = await signedIn();
    const injected: Record<string, string>[] = [
      { range: "bytes=0-1\r\nX-Evil: 1" },
      { "if-none-match": `"evil\r\nSet-Cookie: evil=1", ${'"x",'.repeat(2000)} "evil"` },
    ];
    for (const raw of injected) {
      const req = new Request("http://localhost/media/exercises/0001");
      Object.defineProperty(req, "headers", { value: new RawHeaders({ cookie }, raw) });
      const res = await app.fetch(req);
      expect([200, 206, 416], JSON.stringify(raw).slice(0, 40)).toContain(res.status);
      expect(res.headers.get("etag")).toBe(etag);
      expect(res.headers.get("x-evil")).toBeNull();
      res.headers.forEach((value, name) => {
        expect(`${name}: ${value}`).not.toMatch(/evil|[\r\n]/i);
      });
    }
  });
});
