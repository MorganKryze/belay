// The iPhone app's session: the token its native side keeps in the Keychain for the stored
// instance, and the sign-in that earns it through the system sheet. Loaded on the phone only,
// before the first render (main.tsx), so the first request already carries the token.
import { registerPlugin } from "@capacitor/core";
import { Haptics, NotificationType } from "@capacitor/haptics";
import { readInstance, setNativeSession } from "@/lib/platform";

export interface BelayNativePlugin {
  readToken(o: { origin: string }): Promise<{ token: string | null }>;
  writeToken(o: { origin: string; token: string }): Promise<void>;
  clearToken(): Promise<void>;
  // Rejects with code "cancelled" when the person closes the sheet.
  authenticate(o: { url: string; callbackScheme: string }): Promise<{ url: string }>;
}

const BelayNative = registerPlugin<BelayNativePlugin>("BelayNative");

export type SignInResult = "cancelled" | "unavailable" | "expired" | "failed" | "denied";
// The reasons the server puts in the app's callback, the same Accueil shows after a web sign-in.
const REASONS = ["unavailable", "expired", "failed", "denied"] as const;
const isReason = (v: string | null): v is (typeof REASONS)[number] =>
  (REASONS as readonly (string | null)[]).includes(v);

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// Only a path of this app: "//host" or "/\host" would leave it, and so would "/\t/host", since
// the URL parser drops tabs and newlines. No control character, no backslash, and the resolved
// URL still on this app. Scheme and host, not origin: capacitor:// has an opaque origin ("null").
const inApp = (url: URL): boolean => {
  const here = new URL(location.href);
  return url.protocol === here.protocol && url.host === here.host;
};
const safe = (path: string): string => {
  if (!path.startsWith("/") || path.startsWith("//") || /[\p{Cc}\\]/u.test(path)) return "/";
  return inApp(new URL(path, location.href)) ? path : "/";
};

export async function signIn(returnTo: string): Promise<SignInResult> {
  const origin = readInstance();
  if (origin === null) return "failed";
  // The verifier stays in this function: only its hash goes to the sheet, and the verifier
  // itself only to the exchange that proves this app asked for the code.
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  let callback: URL;
  try {
    const { url } = await BelayNative.authenticate({
      url: `${origin}/auth/native/start?challenge=${await challengeOf(verifier)}`,
      callbackScheme: "belay",
    });
    callback = new URL(url);
  } catch (error) {
    return (error as { code?: unknown }).code === "cancelled" ? "cancelled" : "failed";
  }
  if (callback.protocol !== "belay:") return "failed";
  const reason = callback.searchParams.get("error");
  if (reason !== null) return isReason(reason) ? reason : "failed";
  const code = callback.searchParams.get("code");
  if (code === null) return "failed";

  let response: Response;
  try {
    response = await fetch(`${origin}/auth/native/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier }),
      credentials: "omit",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return "unavailable";
  }
  // The server answers 400 to every refused code: used, past its minute, or another verifier.
  if (response.status === 400) return "expired";
  if (!response.ok) return "failed";
  const body = (await response.json().catch(() => null)) as { token?: unknown } | null;
  if (typeof body?.token !== "string") return "failed";
  await BelayNative.writeToken({ origin, token: body.token });
  // A fresh start reads the new token before the first request, as at launch. The page is
  // leaving, so this never settles.
  location.replace(safe(returnTo));
  return new Promise<never>(() => {});
}

export async function install(): Promise<void> {
  const origin = readInstance();
  const token = origin ? (await BelayNative.readToken({ origin })).token : null;
  setNativeSession({
    token: (o) => (o === origin ? token : null),
    forget: () => BelayNative.clearToken(),
  });

  // The page's sign-in links go to the server's web sign-in, which the app cannot use (the
  // cookie would land in the system sheet, not here): they open the native sign-in instead.
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link) return;
      const url = new URL(link.getAttribute("href")!, location.href);
      if (!inApp(url) || url.pathname !== "/auth/login") return;
      event.preventDefault();
      void signIn(url.searchParams.get("returnTo") ?? "/").then((result) => {
        if (result !== "cancelled") location.assign(`/?signin=${result}`);
      });
    },
    { capture: true },
  );

  // WebKit has no vibration API, so the rest's end would be silent in the hand: a success haptic
  // stands in for it. A device without a haptic engine just stays still.
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    value: () => {
      Haptics.notification({ type: NotificationType.Success }).catch(() => {});
      return true;
    },
  });
}
