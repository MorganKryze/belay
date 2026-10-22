import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// 1 000 known bytes stand in for a loop: the cache is checked byte for byte, no video is needed.
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const LOOP = "**/media/exercises/*";

let served: string[];

test.beforeEach(async ({ page, context }) => {
  served = [];
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
  // The service worker fetches the loops: only the context's routes see its requests.
  await context.route(LOOP, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    served.push(`${id} ${route.request().headers().range ?? ""}`.trim());
    if (id === "0001") {
      return route.fulfill({ status: 200, contentType: "video/mp4", body: BYTES });
    }
    return route.fulfill({ status: id === "0401" ? 401 : 404, body: "" });
  });
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
});

async function goOffline(context: BrowserContext): Promise<void> {
  await context.unroute(LOOP);
  await context.setOffline(true);
}

function fetchLoop(page: Page, path: string, range?: string) {
  return page.evaluate(
    async ([path, range]) => {
      const res = await fetch(path, range ? { headers: { Range: range } } : {});
      return {
        status: res.status,
        range: res.headers.get("Content-Range"),
        bytes: Array.from(new Uint8Array(await res.arrayBuffer())),
      };
    },
    [path, range] as const,
  );
}

function cached(page: Page) {
  return page.evaluate(async () => {
    const cache = await caches.open("belay-media");
    const keys = await cache.keys();
    return Promise.all(
      keys.map(async (key) => ({
        path: new URL(key.url).pathname,
        size: (await (await cache.match(key))!.arrayBuffer()).byteLength,
      })),
    );
  });
}

test("a loop fetched once answers from the cache offline", async ({ page, context }) => {
  const online = await fetchLoop(page, "/media/exercises/0001");
  expect(online.status).toBe(200);
  expect(served).toEqual(["0001"]);
  await expect.poll(() => cached(page)).toHaveLength(1);

  await goOffline(context);
  const offline = await fetchLoop(page, "/media/exercises/0001");
  expect(offline.status).toBe(200);
  expect(offline.bytes).toEqual([...BYTES]);
  expect(await cached(page)).toEqual([{ path: "/media/exercises/0001", size: 1000 }]);
});

test("a byte range of a cached loop answers 206 offline", async ({ page, context }) => {
  await fetchLoop(page, "/media/exercises/0001");
  await expect.poll(() => cached(page)).toHaveLength(1);

  await goOffline(context);
  const part = await fetchLoop(page, "/media/exercises/0001", "bytes=10-19");
  expect(part.status).toBe(206);
  expect(part.range).toBe("bytes 10-19/1000");
  expect(part.bytes).toEqual([...BYTES.subarray(10, 20)]);
});

test("a ranged first fetch caches the whole file", async ({ page }) => {
  const first = await fetchLoop(page, "/media/exercises/0001", "bytes=0-1");
  expect(first.status).toBe(206);
  expect(first.bytes).toEqual([0, 1]);
  // The network saw no Range: the whole file came back and went into the cache.
  expect(served).toEqual(["0001"]);
  await expect.poll(() => cached(page)).toEqual([{ path: "/media/exercises/0001", size: 1000 }]);
});

test("a 404 or a 401 is never cached", async ({ page }) => {
  expect((await fetchLoop(page, "/media/exercises/0404")).status).toBe(404);
  expect((await fetchLoop(page, "/media/exercises/0401")).status).toBe(401);
  expect(served).toEqual(["0404", "0401"]);
  // A cached answer would come back without reaching the network: a second round must reach it.
  await fetchLoop(page, "/media/exercises/0404");
  expect(served).toHaveLength(3);
  expect(await cached(page)).toEqual([]);
});

test("a navigation to /media/exercises/0001 offline is not answered with the app shell", async ({
  page,
  context,
}) => {
  await goOffline(context);
  await page.goto("/media/exercises/0001").catch(() => undefined);
  // The shell's launch screen and app root are in its HTML: neither may be there.
  await expect(page.locator(".launch, #root")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Belay" })).toHaveCount(0);
});

test("the precache lists no .mp4 and no /media/ path", async ({ page }) => {
  const precached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.includes("precache")) continue;
      for (const key of await (await caches.open(name)).keys()) urls.push(key.url);
    }
    return urls;
  });
  expect(precached.length).toBeGreaterThan(0);
  expect(precached.filter((url) => /\.mp4|\/media\//.test(url))).toEqual([]);
});
