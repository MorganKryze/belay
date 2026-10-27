// What the person types on the instance screen, and the question asked to the address. Loaded
// with that screen only.

// The hosts a development build's content security policy lets the app reach over plain http.
const LOCAL = new Set(["localhost", "127.0.0.1"]);

// A release's policy blocks plain http everywhere, so it only ever reaches an instance over https.
// The dev server sends no policy, and a build made with BELAY_LOOPBACK=1 allows this machine.
const reachesThisMachine = () => import.meta.env.DEV || import.meta.env.BELAY_LOOPBACK === "1";

// The constructor rather than URL.parse, which iPhones before iOS 18 lack.
function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

export type AddressCheck = { origin: string } | { error: "invalid" | "insecure" };

// What the person typed, as an instance origin: https added when no scheme is given, any path
// dropped (Belay is served at the root of its address). Plain http only reaches this machine, for
// a server run on the developer's own computer, and only from a build made for it.
export function checkAddress(input: string): AddressCheck {
  const text = input.trim();
  if (text === "") return { error: "invalid" };
  const url = parseUrl(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  if (!url || url.username !== "" || url.password !== "" || url.hostname === "") {
    return { error: "invalid" };
  }
  if (url.protocol === "https:") return { origin: url.origin };
  if (url.protocol !== "http:") return { error: "invalid" };
  return reachesThisMachine() && LOCAL.has(url.hostname)
    ? { origin: url.origin }
    : { error: "insecure" };
}

export type Probe = { origin: string } | { error: "offline" | "unreachable" | "not-belay" };

// A server that does not answer in this time is reported unreachable rather than left spinning.
const PROBE_TIMEOUT_MS = 10_000;

// Asks an address whether a Belay instance answers there, and for the origin it is served at. An
// instance too old to answer, or one that refuses this app, fails like an unreachable one: the
// browser hides its answer.
export async function probeInstance(origin: string): Promise<Probe> {
  if (!navigator.onLine) return { error: "offline" };
  let res: Response;
  try {
    res = await fetch(`${origin}/api/instance`, {
      credentials: "omit",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return { error: "unreachable" };
  }
  const body: unknown = res.ok ? await res.json().catch(() => null) : null;
  if (typeof body !== "object" || body === null) return { error: "not-belay" };
  const { app, api, origin: served } = body as Record<string, unknown>;
  if (app !== "belay" || typeof api !== "number" || api < 1 || typeof served !== "string") {
    return { error: "not-belay" };
  }
  const checked = checkAddress(served);
  return "origin" in checked && checked.origin === served
    ? { origin: served }
    : { error: "not-belay" };
}
