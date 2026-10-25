import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { plugin, haptics } = vi.hoisted(() => ({
  plugin: {
    readToken: vi.fn<(o: { origin: string }) => Promise<{ token: string | null }>>(),
    writeToken: vi.fn<(o: { origin: string; token: string }) => Promise<void>>(),
    clearToken: vi.fn<() => Promise<void>>(),
    authenticate: vi.fn<(o: { url: string; callbackScheme: string }) => Promise<{ url: string }>>(),
  },
  haptics: { notification: vi.fn<(o: { type: string }) => Promise<void>>() },
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => plugin }));
vi.mock("@capacitor/haptics", () => ({
  Haptics: haptics,
  NotificationType: { Success: "SUCCESS" },
}));

const ORIGIN = "https://belay.example.org";
const TOKEN = "t".repeat(43);
const fetchMock = vi.fn<typeof fetch>();
const replace = vi.fn();
const assign = vi.fn();
const listeners: Parameters<typeof document.addEventListener>[] = [];

// Fresh modules each time: the platform's session is module state, and install() sets it.
const load = async () => ({
  ...(await import("./session")),
  ...(await import("@/lib/platform")),
});
const cancelled = () => Object.assign(new Error("closed"), { code: "cancelled" });
const sentChallenge = () =>
  new URL(plugin.authenticate.mock.calls[0]![0].url).searchParams.get("challenge");
const sentBody = () =>
  JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { code: string; verifier: string };

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("belay.instance", ORIGIN);
  for (const fn of [...Object.values(plugin), haptics.notification, fetchMock, replace, assign])
    fn.mockReset();
  plugin.readToken.mockResolvedValue({ token: TOKEN });
  plugin.writeToken.mockResolvedValue();
  plugin.clearToken.mockResolvedValue();
  haptics.notification.mockResolvedValue();
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { href: "capacitor://localhost/", replace, assign });
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation((...args) => {
    listeners.push(args);
    add(...args);
  });
});
afterEach(() => {
  for (const args of listeners.splice(0)) document.removeEventListener(...args);
  Reflect.deleteProperty(navigator, "vibrate");
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the session kept on the phone", () => {
  it("install reads the token of the stored instance and hands it out for that origin only", async () => {
    const { install, nativeSession } = await load();
    await install();
    expect(plugin.readToken).toHaveBeenCalledWith({ origin: ORIGIN });
    expect(nativeSession()?.token(ORIGIN)).toBe(TOKEN);
    expect(nativeSession()?.token("https://other.example.org")).toBeNull();
  });

  it("forget clears the Keychain", async () => {
    const { install, nativeSession } = await load();
    await install();
    await nativeSession()?.forget();
    expect(plugin.clearToken).toHaveBeenCalledOnce();
  });

  it("install failing leaves no session and throws nothing to main", async () => {
    plugin.readToken.mockRejectedValue(new Error("keychain locked"));
    const { nativeSession } = await load();
    // The very chain main.tsx runs before the first render.
    await expect(
      import("./session").then((m) => m.install()).catch(() => {}),
    ).resolves.toBeUndefined();
    expect(nativeSession()).toBeNull();
  });
});

describe("signing in through the system sheet", () => {
  it("challengeOf is the base64url SHA-256 of the verifier (RFC 7636 appendix B vector)", async () => {
    const { challengeOf } = await load();
    expect(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("signIn opens the instance's start with a 43-character challenge and the belay scheme", async () => {
    plugin.authenticate.mockRejectedValue(cancelled());
    const { signIn } = await load();
    await signIn("/");
    const { url, callbackScheme } = plugin.authenticate.mock.calls[0]![0];
    expect(url.startsWith(`${ORIGIN}/auth/native/start?challenge=`)).toBe(true);
    expect(sentChallenge()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(callbackScheme).toBe("belay");
  });

  it("a code is exchanged with the verifier whose challenge was sent, the token kept for the instance, the app reopened at returnTo", async () => {
    plugin.authenticate.mockResolvedValue({ url: "belay://auth?code=one-time" });
    fetchMock.mockResolvedValue(Response.json({ token: TOKEN }));
    const { signIn, challengeOf } = await load();
    void signIn("/workouts");
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/workouts"));
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/auth/native/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: expect.any(String),
      credentials: "omit",
      signal: expect.any(AbortSignal),
    });
    const { code, verifier } = sentBody();
    expect(code).toBe("one-time");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await challengeOf(verifier)).toBe(sentChallenge());
    expect(plugin.writeToken).toHaveBeenCalledWith({ origin: ORIGIN, token: TOKEN });
  });

  it("a closed sheet is cancelled, nothing kept", async () => {
    plugin.authenticate.mockRejectedValue(cancelled());
    const { signIn } = await load();
    expect(await signIn("/")).toBe("cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(plugin.writeToken).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("an error in the callback comes back as that reason", async () => {
    const { signIn } = await load();
    plugin.authenticate.mockResolvedValue({ url: "belay://auth?error=denied" });
    expect(await signIn("/")).toBe("denied");
    plugin.authenticate.mockResolvedValue({ url: "belay://auth?error=something-else" });
    expect(await signIn("/")).toBe("failed");
    plugin.authenticate.mockResolvedValue({ url: "https://evil.example/?code=one-time" });
    expect(await signIn("/")).toBe("failed");
    plugin.authenticate.mockRejectedValue(new Error("busy"));
    expect(await signIn("/")).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(plugin.writeToken).not.toHaveBeenCalled();
  });

  it("a refused code is expired, a network failure unavailable", async () => {
    plugin.authenticate.mockResolvedValue({ url: "belay://auth?code=one-time" });
    const { signIn } = await load();
    fetchMock.mockResolvedValueOnce(Response.json({ error: "invalid_grant" }, { status: 400 }));
    expect(await signIn("/")).toBe("expired");
    fetchMock.mockRejectedValueOnce(new TypeError("Load failed"));
    expect(await signIn("/")).toBe("unavailable");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await signIn("/")).toBe("failed");
    fetchMock.mockResolvedValueOnce(Response.json({ token: 42 }));
    expect(await signIn("/")).toBe("failed");
    expect(plugin.writeToken).not.toHaveBeenCalled();
  });

  it("returnTo that is not one app path becomes /", async () => {
    plugin.authenticate.mockResolvedValue({ url: "belay://auth?code=one-time" });
    fetchMock.mockImplementation(async () => Response.json({ token: TOKEN }));
    const { signIn } = await load();
    for (const returnTo of [
      "//evil.example/x",
      "/\\evil.example",
      "https://evil.example",
      "",
      "/\t/evil.example",
      "/\n/evil.example",
      "/a\\b",
      "/\u0000x",
    ]) {
      replace.mockClear();
      void signIn(returnTo);
      await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    }
  });

  it("without an instance nothing opens", async () => {
    localStorage.clear();
    const { signIn } = await load();
    expect(await signIn("/")).toBe("failed");
    expect(plugin.authenticate).not.toHaveBeenCalled();
  });
});

describe("the page's sign-in links and vibrations", () => {
  it("a click on a sign-in link of this app (none elsewhere) runs the native sign-in with its returnTo and shows a failure on Accueil", async () => {
    document.body.innerHTML = `
      <a id="in" href="/auth/login?returnTo=%2Fworkouts"><span>Se connecter</span></a>
      <a id="out" href="/settings">Réglages</a>
      <a id="elsewhere" href="https://other.example/auth/login">Ailleurs</a>`;
    plugin.authenticate.mockResolvedValue({ url: "belay://auth?error=denied" });
    const { install } = await load();
    await install();

    for (const id of ["#out", "#elsewhere"]) {
      const other = new MouseEvent("click", { bubbles: true, cancelable: true });
      document.querySelector(id)!.dispatchEvent(other);
      expect(other.defaultPrevented).toBe(false);
    }
    expect(plugin.authenticate).not.toHaveBeenCalled();

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("#in span")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/?signin=denied"));
    expect(plugin.authenticate).toHaveBeenCalledOnce();
  });

  it("a cancelled sheet from a link stays where it was", async () => {
    document.body.innerHTML = `<a id="in" href="/auth/login?returnTo=%2F">Se connecter</a>`;
    plugin.authenticate.mockRejectedValue(cancelled());
    const { install } = await load();
    await install();
    document.querySelector<HTMLAnchorElement>("#in")!.click();
    await vi.waitFor(() => expect(plugin.authenticate).toHaveBeenCalledOnce());
    await new Promise((settle) => setTimeout(settle, 10));
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("vibrate gives a success haptic", async () => {
    haptics.notification.mockRejectedValue(new Error("no engine"));
    const { install } = await load();
    await install();
    expect(navigator.vibrate(200)).toBe(true);
    expect(haptics.notification).toHaveBeenCalledWith({ type: "SUCCESS" });
  });
});
