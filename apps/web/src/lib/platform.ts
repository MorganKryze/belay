// Where the app runs and which server it talks to. In a browser the page comes from its own
// server, always asked at the same origin with the session cookie. In the phone app the page comes
// from the app itself: the person gives their instance's address once, it is kept here, and each
// request carries the session token the app's native side keeps for that address. Startup-safe:
// the native code itself stays in lazy modules.

type WithCapacitor = typeof globalThis & {
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
};

// The app's native side defines this global before the page's first script runs; a browser never
// has it.
export const isNative = (): boolean =>
  (globalThis as WithCapacitor).Capacitor?.isNativePlatform?.() === true;

// Which phone app the page runs in, or null in a browser.
export const nativePlatform = (): "ios" | "android" | null => {
  if (!isNative()) return null;
  return (globalThis as WithCapacitor).Capacitor?.getPlatform?.() === "android" ? "android" : "ios";
};

const KEY = "belay.instance";

// The address is written only once the instance has answered (native/address.ts). Where storage
// refuses, nothing is kept and the app asks again at the next launch.
export function readInstance(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeInstance(origin: string): void {
  try {
    localStorage.setItem(KEY, origin);
  } catch {
    // Asked again at the next launch.
  }
}

// The app's native side, once it has read the token kept for the stored instance.
export interface NativeSession {
  // The token kept for exactly this origin, or null: one instance's token never goes to another.
  token(origin: string): string | null;
  // Signs this app out: the token leaves the device.
  forget(): Promise<void>;
}
let session: NativeSession | null = null;
export const setNativeSession = (s: NativeSession): void => {
  session = s;
};
export const nativeSession = (): NativeSession | null => session;

// A path of the server (`/api/sync`) as this app must ask for it: unchanged in a browser, on the
// stored instance in the app.
export function apiUrl(path: string): string {
  return isNative() ? `${readInstance() ?? ""}${path}` : path;
}

// fetch for the server's own routes. In a browser: same origin, with the cookie, as always. In
// the app: the stored instance, the token in an Authorization header, never a cookie; with no
// instance stored nothing leaves the device.
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!isNative()) return fetch(path, { ...init, credentials: "same-origin" });
  const origin = readInstance();
  if (origin === null) return Promise.reject(new Error("no instance address yet"));
  const headers = new Headers(init.headers);
  const token = session?.token(origin) ?? null;
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${origin}${path}`, { ...init, headers, credentials: "omit" });
}
