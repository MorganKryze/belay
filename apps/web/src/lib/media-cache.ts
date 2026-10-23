import type { VitePWAOptions } from "vite-plugin-pwa";

// The service worker's route for exercise loops. The build writes every function below into the
// generated worker as source text, away from this module: each one references no import and no
// outer constant, its literals written inline.

type RuntimeCaching = NonNullable<NonNullable<VitePWAOptions["workbox"]>["runtimeCaching"]>[number];

export const mediaRangePlugin = {
  // The network is always asked for the whole file, so the cache only ever holds a full 200.
  requestWillFetch: async ({ request }: { request: Request }): Promise<Request> => {
    const headers = new Headers(request.headers);
    headers.delete("Range");
    return new Request(request.url, { headers, credentials: "same-origin" });
  },
  // A video element asks for byte ranges: the whole answer, cached or fresh, is cut to the one
  // range asked for. Several ranges or an unreadable one get the whole file, as a server may do.
  handlerWillRespond: async ({
    request,
    response,
  }: {
    request: Request;
    response: Response;
  }): Promise<Response> => {
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") ?? "");
    if (!range || response.status !== 200 || (range[1] === "" && range[2] === "")) {
      return response;
    }
    const first = range[1] === "" ? null : Number(range[1]);
    const last = range[2] === "" ? null : Number(range[2]);
    if (first !== null && last !== null && last < first) return response;

    const body = await response.arrayBuffer();
    const size = body.byteLength;
    const start = first === null ? Math.max(0, size - (last as number)) : first;
    const end = first === null || last === null ? size - 1 : Math.min(last, size - 1);
    if (start >= size || (first === null && last === 0)) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    });
    const type = response.headers.get("Content-Type");
    if (type) headers.set("Content-Type", type);
    return new Response(body.slice(start, end + 1), { status: 206, headers });
  },
};

export const mediaRuntimeCaching: RuntimeCaching = {
  urlPattern: ({ url, sameOrigin }) =>
    sameOrigin && /^\/media\/exercises\/\d{4}$/.test(url.pathname),
  handler: "CacheFirst",
  options: {
    cacheName: "belay-media",
    // About 30 days, 150 loops, and the first thing dropped when the device runs short of space.
    expiration: { maxEntries: 150, maxAgeSeconds: 2_592_000, purgeOnQuotaError: true },
    cacheableResponse: { statuses: [200] },
    plugins: [mediaRangePlugin],
  },
};
