import type { SyncRequest } from "@belay/shared/sync/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postSync } from "@/sync/transport";
import { fetchMe, logout } from "./api";
import { checkAddress, probeInstance } from "@/native/address";
import { apiFetch, isNative, setNativeSession, writeInstance } from "./platform";

const ORIGIN = "https://belay.example.org";
const asApp = () => vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
const fetchMock = vi.fn<typeof fetch>();
const forget = vi.fn(async () => {});
const tokens: Record<string, string> = { [ORIGIN]: "tok-1" };

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  forget.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  setNativeSession({ token: (origin) => tokens[origin] ?? null, forget });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const call = (i = 0) => {
  const [input, init] = fetchMock.mock.calls[i]!;
  return { url: String(input), init: init!, headers: new Headers(init?.headers) };
};

describe("in a browser", () => {
  it("is not the app", () => expect(isNative()).toBe(false));

  it("asks the page's own server with the cookie and no token", async () => {
    writeInstance(ORIGIN);
    fetchMock.mockResolvedValue(Response.json({ id: "u1", displayName: "Ana" }));
    await fetchMe();
    expect(fetchMock).toHaveBeenCalledWith("/api/me", { credentials: "same-origin" });
  });

  it("sends the sync to the page's own server", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    const request = { account: "u1", cursor: "0", changes: [] } as unknown as SyncRequest;
    await postSync(request);
    expect(fetchMock).toHaveBeenCalledWith("/api/sync", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: expect.any(AbortSignal),
    });
  });

  it("signs out on the page's own server and follows its redirect", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    fetchMock.mockResolvedValue(Response.json({ redirectTo: "https://idp.example/logout" }));
    await logout();
    expect(fetchMock).toHaveBeenCalledWith("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    expect(forget).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("https://idp.example/logout");
  });
});

describe("in the app", () => {
  beforeEach(asApp);

  it("asks the stored instance with its token and never a cookie", async () => {
    writeInstance(ORIGIN);
    fetchMock.mockResolvedValue(Response.json({ id: "u1", displayName: "Ana" }));
    await expect(fetchMe()).resolves.toMatchObject({ id: "u1" });
    const { url, init, headers } = call();
    expect(url).toBe(`${ORIGIN}/api/me`);
    expect(init.credentials).toBe("omit");
    expect(headers.get("Authorization")).toBe("Bearer tok-1");
  });

  it("takes a refused session on the instance as signed out", async () => {
    writeInstance(ORIGIN);
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(fetchMe()).resolves.toBeNull();
    expect(call().headers.get("Authorization")).toBe("Bearer tok-1");
  });

  it("sends nothing before an instance address is known", async () => {
    await expect(fetchMe()).resolves.toBeNull();
    await expect(apiFetch("/api/me")).rejects.toThrow();
    const sent = await postSync({
      account: "u1",
      cursor: "0",
      changes: [],
    } as unknown as SyncRequest);
    expect(sent).toEqual({ kind: "offline" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sends one instance's token to another", async () => {
    writeInstance("https://other.example.org");
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(fetchMe()).resolves.toBeNull();
    expect(call().url).toBe("https://other.example.org/api/me");
    expect(call().headers.has("Authorization")).toBe(false);
  });

  it("sends the sync to the stored instance with the token", async () => {
    writeInstance(ORIGIN);
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    const sent = await postSync({
      account: "u1",
      cursor: "0",
      changes: [],
    } as unknown as SyncRequest);
    expect(sent).toEqual({ kind: "expired" });
    expect(call().url).toBe(`${ORIGIN}/api/sync`);
    expect(call().headers.get("Authorization")).toBe("Bearer tok-1");
    expect(call().headers.get("content-type")).toBe("application/json");
  });

  it("signs out on the instance as JSON, forgets the token and goes back to the start", async () => {
    writeInstance(ORIGIN);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    fetchMock.mockResolvedValue(Response.json({ redirectTo: "https://idp.example/logout" }));
    await logout();
    expect(call().url).toBe(`${ORIGIN}/auth/logout`);
    expect(call().headers.get("content-type")).toBe("application/json");
    expect(forget).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("keeps the token when the instance cannot be reached at sign-out", async () => {
    writeInstance(ORIGIN);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(logout()).rejects.toThrow();
    expect(forget).not.toHaveBeenCalled();
  });

  it("keeps the token and the page when the instance refuses the sign-out", async () => {
    writeInstance(ORIGIN);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    fetchMock.mockResolvedValue(Response.json({ error: "server_error" }, { status: 500 }));
    await expect(logout()).rejects.toThrow();
    expect(forget).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("checkAddress", () => {
  it.each([
    ["belay.example.org", ORIGIN],
    ["  belay.example.org  ", ORIGIN],
    ["https://belay.example.org/", ORIGIN],
    ["https://belay.example.org/some/path?x=1", ORIGIN],
    ["HTTPS://Belay.Example.org", ORIGIN],
    ["belay.example.org:8443", "https://belay.example.org:8443"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
  ])("reads %j as %s", (input, origin) => expect(checkAddress(input)).toEqual({ origin }));

  it.each([
    "",
    "   ",
    "belay example",
    "https://ana:pw@belay.example.org",
    "ftp://belay.example.org",
  ])("refuses %j", (input) => expect(checkAddress(input)).toEqual({ error: "invalid" }));

  it("asks for https anywhere but this machine", () =>
    expect(checkAddress("http://belay.example.org")).toEqual({ error: "insecure" }));

  // URL.parse arrived with iOS 18; the app also runs on older iPhones.
  it("reads an address where URL.parse does not exist", () => {
    vi.spyOn(URL, "parse").mockImplementation(() => {
      throw new TypeError("URL.parse is not a function");
    });
    expect(checkAddress("belay.example.org")).toEqual({ origin: ORIGIN });
    expect(checkAddress("belay example")).toEqual({ error: "invalid" });
  });
});

describe("probeInstance", () => {
  const answer = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValue(Response.json(body, { status }));

  it("finds a Belay instance and keeps the origin it is served at", async () => {
    answer({ app: "belay", api: 1, origin: ORIGIN });
    await expect(probeInstance("https://belay-alias.example.org")).resolves.toEqual({
      origin: ORIGIN,
    });
    expect(call().url).toBe("https://belay-alias.example.org/api/instance");
    expect(call().init.credentials).toBe("omit");
  });

  it.each([
    [{ app: "other", api: 1, origin: ORIGIN }, 200],
    [{ app: "belay", origin: ORIGIN }, 200],
    [{ app: "belay", api: 1, origin: "http://belay.example.org" }, 200],
    [{ error: "not_found" }, 404],
  ])("says %j (%i) is not a Belay instance", async (body, status) => {
    answer(body, status);
    await expect(probeInstance(ORIGIN)).resolves.toEqual({ error: "not-belay" });
  });

  it("says an HTML page is not a Belay instance", async () => {
    fetchMock.mockResolvedValue(new Response("<!doctype html>", { status: 200 }));
    await expect(probeInstance(ORIGIN)).resolves.toEqual({ error: "not-belay" });
  });

  it("says unreachable when the request fails or times out", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(probeInstance(ORIGIN)).resolves.toEqual({ error: "unreachable" });
  });

  it("says offline without asking when the device has no network", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await expect(probeInstance(ORIGIN)).resolves.toEqual({ error: "offline" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("startUpdates", () => {
  it("registers the service worker in a browser, never in the app", async () => {
    vi.resetModules();
    const registerSW = vi.fn(() => async () => {});
    vi.doMock("virtual:pwa-register", () => ({ registerSW }));
    const { startUpdates } = await import("./update");
    asApp();
    startUpdates();
    expect(registerSW).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    startUpdates();
    expect(registerSW).toHaveBeenCalledOnce();
    vi.doUnmock("virtual:pwa-register");
  });
});
