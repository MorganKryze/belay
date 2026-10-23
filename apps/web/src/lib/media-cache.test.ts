// Node's own Request and Response: jsdom has none, the package's setup file needs its window.
import { describe, expect, it } from "vitest";
import { mediaRangePlugin, mediaRuntimeCaching } from "./media-cache";

const URL_0001 = "https://belay.test/media/exercises/0001";
const BYTES = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);

function loop(status = 200): Response {
  return new Response(status === 200 ? BYTES : null, {
    status,
    headers: { "Content-Type": "video/mp4" },
  });
}

function ranged(range?: string): Request {
  return new Request(URL_0001, range ? { headers: { Range: range } } : {});
}

type Plugin = typeof mediaRangePlugin;

async function slice(plugin: Plugin, range: string) {
  const res = await plugin.handlerWillRespond({ request: ranged(range), response: loop() });
  return { res, body: new Uint8Array(await res.arrayBuffer()) };
}

describe("mediaRangePlugin", () => {
  it("fetches the whole file: the Range header is dropped, the URL kept", async () => {
    const request = new Request(URL_0001, {
      headers: { Range: "bytes=0-1", Accept: "video/*" },
    });
    const out = await mediaRangePlugin.requestWillFetch({ request });
    expect(out.url).toBe(URL_0001);
    expect(out.headers.has("Range")).toBe(false);
    expect(out.headers.get("Accept")).toBe("video/*");
    expect(out.credentials).toBe("same-origin");
  });

  it("slices bytes=0-1, bytes=10- and bytes=-10 of a 1 000-byte answer into 206 with Content-Range and length", async () => {
    const cases = [
      ["bytes=0-1", 0, 1],
      ["bytes=10-", 10, 999],
      ["bytes=-10", 990, 999],
      ["bytes=995-5000", 995, 999],
    ] as const;
    for (const [range, start, end] of cases) {
      const { res, body } = await slice(mediaRangePlugin, range);
      expect(res.status, range).toBe(206);
      expect(res.headers.get("Content-Range")).toBe(`bytes ${start}-${end}/1000`);
      expect(res.headers.get("Content-Length")).toBe(String(end - start + 1));
      expect(res.headers.get("Content-Type")).toBe("video/mp4");
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
      expect(Array.from(body)).toEqual(Array.from(BYTES.slice(start, end + 1)));
    }
  });

  it("answers 416 with bytes */1000 past the end", async () => {
    for (const range of ["bytes=1000-", "bytes=1000-1001", "bytes=-0"]) {
      const { res, body } = await slice(mediaRangePlugin, range);
      expect(res.status, range).toBe(416);
      expect(res.headers.get("Content-Range")).toBe("bytes */1000");
      expect(body).toHaveLength(0);
    }
  });

  it("leaves a 404, a 401 and an answer without Range untouched", async () => {
    for (const status of [404, 401]) {
      const response = loop(status);
      const out = await mediaRangePlugin.handlerWillRespond({
        request: ranged("bytes=0-1"),
        response,
      });
      expect(out).toBe(response);
    }
    const whole = loop();
    expect(await mediaRangePlugin.handlerWillRespond({ request: ranged(), response: whole })).toBe(
      whole,
    );
    for (const range of ["bytes=0-1,5-6", "bytes=-", "bytes=5-2", "items=0-1"]) {
      const response = loop();
      const out = await mediaRangePlugin.handlerWillRespond({ request: ranged(range), response });
      expect(out, range).toBe(response);
    }
  });

  it("every function survives being stringified", async () => {
    const rebuild = <T>(fn: T): T => new Function(`return (${String(fn)});`)() as T;
    const plugin: Plugin = {
      requestWillFetch: rebuild(mediaRangePlugin.requestWillFetch),
      handlerWillRespond: rebuild(mediaRangePlugin.handlerWillRespond),
    };
    const out = await plugin.requestWillFetch({ request: ranged("bytes=0-1") });
    expect(out.headers.has("Range")).toBe(false);
    const { res, body } = await slice(plugin, "bytes=-10");
    expect(res.status).toBe(206);
    expect(Array.from(body)).toEqual(Array.from(BYTES.slice(990)));

    const match = rebuild(mediaRuntimeCaching.urlPattern) as (p: {
      url: URL;
      sameOrigin: boolean;
    }) => boolean;
    expect(match({ url: new URL(URL_0001), sameOrigin: true })).toBe(true);
  });
});

describe("mediaRuntimeCaching", () => {
  const match = mediaRuntimeCaching.urlPattern as (p: { url: URL; sameOrigin: boolean }) => boolean;
  const at = (path: string, sameOrigin = true) =>
    match({ url: new URL(path, "https://belay.test"), sameOrigin });

  it("matches /media/exercises/0001 on this origin only, never /media/exercises/1, /media/x or another origin", () => {
    expect(at("/media/exercises/0001")).toBe(true);
    expect(at("/media/exercises/0001", false)).toBe(false);
    for (const path of [
      "/media/exercises/1",
      "/media/exercises/00012",
      "/media/exercises/0001/x",
      "/media/x",
      "/api/media/exercises/0001",
    ]) {
      expect(at(path), path).toBe(false);
    }
  });

  it("keeps at most 150 loops for 30 days, purges on a quota error, caches 200 only, in belay-media", () => {
    expect(mediaRuntimeCaching.handler).toBe("CacheFirst");
    expect(mediaRuntimeCaching.options).toEqual({
      cacheName: "belay-media",
      expiration: { maxEntries: 150, maxAgeSeconds: 2_592_000, purgeOnQuotaError: true },
      cacheableResponse: { statuses: [200] },
      plugins: [mediaRangePlugin],
    });
  });
});
