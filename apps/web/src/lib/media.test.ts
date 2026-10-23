import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchMe, logout } from "./api";
import { MEDIA_CACHE, readMedia, writeMedia } from "./media-flag";
import { loopPath, useLoop } from "./media";

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
