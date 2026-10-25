import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe, logout } from "./api";
import { MEDIA_CACHE, readMedia, writeMedia } from "./media-flag";
import { loopPath, useLoop } from "./media";
import { setNativeSession, writeInstance } from "./platform";

const ADA = { id: "u1", displayName: "Ada" };
const answer = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const online = (value: boolean) => vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
const stubCaches = (cached: string[]) => {
  const del = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("caches", {
    delete: del,
    open: vi.fn().mockResolvedValue({
      match: vi.fn(async (url: string) => (cached.includes(url) ? new Response("") : undefined)),
    }),
  });
  return del;
};

it("fetchMe remembers media on, off, and off when the field is missing", async () => {
  answer({ ...ADA, media: true });
  await fetchMe();
  expect(readMedia()).toBe("on");
  vi.restoreAllMocks();
  answer({ ...ADA, media: false });
  await fetchMe();
  expect(readMedia()).toBe("off");
  writeMedia("on");
  vi.restoreAllMocks();
  answer(ADA);
  await fetchMe();
  expect(readMedia()).toBe("off");
});

it("the remembered value holds when /api/me cannot be reached", async () => {
  writeMedia("on");
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
  await expect(fetchMe()).rejects.toThrow();
  vi.restoreAllMocks();
  answer({}, 500);
  await expect(fetchMe()).rejects.toThrow();
  expect(readMedia()).toBe("on");
});

it("logout deletes the loop cache before leaving, and still signs out without Cache Storage", async () => {
  const del = stubCaches([]);
  del.mockImplementation(async () => {
    expect(assign).not.toHaveBeenCalled();
    return true;
  });
  answer({ redirectTo: "/bye" });
  await logout();
  expect(del).toHaveBeenCalledWith(MEDIA_CACHE);
  expect(assign).toHaveBeenCalledWith("/bye");

  vi.unstubAllGlobals();
  vi.stubGlobal("location", { ...window.location, assign });
  vi.stubGlobal("caches", undefined);
  assign.mockClear();
  vi.restoreAllMocks();
  answer({ redirectTo: "/bye" });
  await logout();
  expect(assign).toHaveBeenCalledWith("/bye");

  vi.stubGlobal("caches", { delete: vi.fn().mockRejectedValue(new Error("denied")) });
  assign.mockClear();
  vi.restoreAllMocks();
  answer({ redirectTo: "/bye" });
  await logout();
  expect(assign).toHaveBeenCalledWith("/bye");
});

it("loopPath maps ds:0025 and refuses belay: ids and anything else", () => {
  expect(loopPath("ds:0025")).toBe("/media/exercises/0025");
  expect(loopPath("belay:0025")).toBeNull();
  expect(loopPath("ds:25")).toBeNull();
  expect(loopPath("ds:00250")).toBeNull();
  expect(loopPath("ds:../x")).toBeNull();
  expect(loopPath("")).toBeNull();
});

it("useLoop gives no source when media is off", () => {
  online(true);
  const { result } = renderHook(() => useLoop("ds:0025"));
  expect(result.current.src).toBeNull();
  writeMedia("on");
  const belay = renderHook(() => useLoop("belay:0001"));
  expect(belay.result.current.src).toBeNull();
  const on = renderHook(() => useLoop("ds:0025"));
  expect(on.result.current.src).toBe("/media/exercises/0025");
});

it("offline, useLoop gives the source only for a cached loop", async () => {
  writeMedia("on");
  online(false);
  stubCaches(["/media/exercises/0025"]);
  const cached = renderHook(() => useLoop("ds:0025"));
  await waitFor(() => expect(cached.result.current.src).toBe("/media/exercises/0025"));
  const missing = renderHook(() => useLoop("ds:0026"));
  await new Promise((r) => setTimeout(r, 20));
  expect(missing.result.current.src).toBeNull();
});

it("going offline keeps the playing source until the cache answers, then follows it", async () => {
  writeMedia("on");
  const status = online(true);
  const answers: ((hit: Response | undefined) => void)[] = [];
  vi.stubGlobal("caches", {
    open: vi.fn().mockResolvedValue({
      match: vi.fn(() => new Promise<Response | undefined>((r) => answers.push(r))),
    }),
  });
  const { result } = renderHook(() => useLoop("ds:0025"));
  expect(result.current.src).toBe("/media/exercises/0025");
  status.mockReturnValue(false);
  act(() => void window.dispatchEvent(new Event("offline")));
  await waitFor(() => expect(answers.length).toBeGreaterThan(0));
  expect(result.current.src).toBe("/media/exercises/0025");
  await act(async () => answers.forEach((answer) => answer(undefined)));
  expect(result.current.src).toBeNull();
});

it("a failed loop is not offered again during the visit", () => {
  writeMedia("on");
  online(true);
  const { result } = renderHook(() => useLoop("ds:0031"));
  expect(result.current.src).toBe("/media/exercises/0031");
  act(() => result.current.failed());
  expect(result.current.src).toBeNull();
  const again = renderHook(() => useLoop("ds:0031"));
  expect(again.result.current.src).toBeNull();
});

it("MEDIA_CACHE is belay-media", () => {
  expect(MEDIA_CACHE).toBe("belay-media");
});

describe("on the phone", () => {
  const INSTANCE = "https://belay.test";
  const TOKEN = "t".repeat(43);
  const made: Blob[] = [];
  const revoked: string[] = [];
  beforeEach(() => {
    writeMedia("on");
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    writeInstance(INSTANCE);
    setNativeSession({ token: (o) => (o === INSTANCE ? TOKEN : null), forget: async () => {} });
    made.length = 0;
    revoked.length = 0;
    // jsdom has no object URLs.
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => `blob:loop-${made.push(blob)}`,
      revokeObjectURL: (url: string) => void revoked.push(url),
    });
  });

  // Cache Storage as WebKit keeps it: keys in the order they were put.
  const stubKept = (initial: string[] = []) => {
    const store = new Map<string, Response>(
      initial.map((url) => [
        url,
        new Response(`kept ${url}`, { headers: { "Content-Type": "video/mp4" } }),
      ]),
    );
    vi.stubGlobal("caches", {
      delete: vi.fn(),
      open: vi.fn(async (name: string) => {
        expect(name).toBe(MEDIA_CACHE);
        return {
          match: async (key: string) => store.get(key)?.clone(),
          put: async (key: string, res: Response) => void store.set(key, res),
          keys: async () => [...store.keys()].map((url) => new Request(url)),
          delete: async (key: Request | string) =>
            store.delete(typeof key === "string" ? key : key.url),
        };
      }),
    });
    return store;
  };
  const serve = (status = 200) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(status === 200 ? "loop bytes" : "", {
          status,
          headers: { "Content-Type": "video/webm" },
        }),
    );

  it("on the phone a loop is fetched with the token and shown from an object URL", async () => {
    online(true);
    stubKept();
    const fetched = serve();
    const { result, unmount } = renderHook(() => useLoop("ds:0041"));
    expect(result.current.src).toBeNull();
    await waitFor(() => expect(result.current.src).toBe("blob:loop-1"));
    const [url, init] = fetched.mock.calls[0]!;
    expect(url).toBe(`${INSTANCE}/media/exercises/0041`);
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(init?.credentials).toBe("omit");
    expect(await made[0]!.text()).toBe("loop bytes");
    unmount();
    expect(revoked).toEqual(["blob:loop-1"]);
  });

  it("an answer landing after the loop has left makes no object URL", async () => {
    online(true);
    stubKept();
    let answer: (res: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((r) => (answer = r)),
    );
    const { unmount } = renderHook(() => useLoop("ds:0042"));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    unmount();
    answer(new Response("late"));
    await new Promise((r) => setTimeout(r, 20));
    expect(made).toEqual([]);
  });

  it("it is kept under its instance address, the oldest past 150 dropped", async () => {
    online(true);
    const old = Array.from({ length: 150 }, (_, i) => `${INSTANCE}/media/exercises/${1000 + i}`);
    const store = stubKept(old);
    serve();
    const { result } = renderHook(() => useLoop("ds:0043"));
    await waitFor(() => expect(result.current.src).toBe("blob:loop-1"));
    await waitFor(() => expect(store.has(`${INSTANCE}/media/exercises/0043`)).toBe(true));
    await waitFor(() => expect(store.size).toBe(150));
    expect(store.has(old[0]!)).toBe(false);
    expect(store.has(old[1]!)).toBe(true);
    // The body is the fetched blob; jsdom cannot read back a Response built from a Blob.
    const kept = store.get(`${INSTANCE}/media/exercises/0043`)!;
    expect(kept.headers.get("Content-Type")).toBe("video/webm");
  });

  it("a kept loop shows without asking the server again", async () => {
    online(true);
    stubKept([`${INSTANCE}/media/exercises/0044`]);
    const fetched = serve();
    const { result } = renderHook(() => useLoop("ds:0044"));
    await waitFor(() => expect(result.current.src).toBe("blob:loop-1"));
    expect(await made[0]!.text()).toBe(`kept ${INSTANCE}/media/exercises/0044`);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("offline, a kept loop shows and a missing one does not", async () => {
    online(false);
    stubKept([`${INSTANCE}/media/exercises/0045`]);
    const fetched = serve();
    const kept = renderHook(() => useLoop("ds:0045"));
    await waitFor(() => expect(kept.result.current.src).toBe("blob:loop-1"));
    const missing = renderHook(() => useLoop("ds:0046"));
    await new Promise((r) => setTimeout(r, 20));
    expect(missing.result.current.src).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });

  it("without Cache Storage a loop still plays, kept nowhere", async () => {
    online(true);
    vi.stubGlobal("caches", undefined);
    serve();
    const { result } = renderHook(() => useLoop("ds:0047"));
    await waitFor(() => expect(result.current.src).toBe("blob:loop-1"));
  });

  it("a failed fetch shows no loop", async () => {
    online(true);
    const store = stubKept();
    serve(404);
    const refused = renderHook(() => useLoop("ds:0048"));
    await new Promise((r) => setTimeout(r, 20));
    expect(refused.result.current.src).toBeNull();
    expect(store.size).toBe(0);
    vi.restoreAllMocks();
    online(true);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    const thrown = renderHook(() => useLoop("ds:0049"));
    await new Promise((r) => setTimeout(r, 20));
    expect(thrown.result.current.src).toBeNull();
    // Not offered again during the visit, as in a browser.
    vi.restoreAllMocks();
    online(true);
    const fetched = serve();
    const again = renderHook(() => useLoop("ds:0049"));
    await new Promise((r) => setTimeout(r, 20));
    expect(again.result.current.src).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });

  it("the browser path is unchanged", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("location", { ...window.location, assign });
    online(true);
    const fetched = serve();
    const { result } = renderHook(() => useLoop("ds:0050"));
    expect(result.current.src).toBe("/media/exercises/0050");
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.src).toBe("/media/exercises/0050");
    expect(fetched).not.toHaveBeenCalled();
    expect(made).toEqual([]);
  });
});
