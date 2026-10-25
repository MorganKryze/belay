import { clearLastUser } from "@/sync/last-user";
import { MEDIA_CACHE, writeMedia } from "./media-flag";
import { apiFetch, isNative, nativeSession, readInstance } from "./platform";

export type Me = { id: string; displayName: string; media?: boolean };

export async function fetchMe(): Promise<Me | null> {
  // The app has no instance address yet: there is nobody to ask.
  if (isNative() && readInstance() === null) return null;
  const res = await apiFetch("/api/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /api/me: ${res.status}`);
  const me = (await res.json()) as Me;
  writeMedia(me.media === true ? "on" : "off");
  return me;
}

// Throws (and never navigates) on any failure, so the caller can tell the user. Once signed out,
// the device forgets which account to open; that account's data stays on it.
export async function logout(): Promise<void> {
  const native = isNative();
  const res = await apiFetch(
    "/auth/logout",
    // The server's cross-site guard reads a POST with no type as a form; the app's is JSON.
    native
      ? { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
      : { method: "POST" },
  );
  if (!res.ok) throw new Error(`POST /auth/logout: ${res.status}`);
  // The app goes back to its own start, the sign-in step.
  let target = "/";
  if (native) {
    // The identity provider's session never outlives the sign-in sheet, which keeps nothing.
    await nativeSession()?.forget();
  } else {
    const body: unknown = await res.json().catch(() => null);
    const redirectTo =
      body !== null && typeof body === "object"
        ? (body as Record<string, unknown>).redirectTo
        : undefined;
    if (typeof redirectTo !== "string" || redirectTo === "") {
      throw new Error("POST /auth/logout: response has no redirectTo");
    }
    target = redirectTo;
  }
  clearLastUser();
  // The loops seen on this device leave with the account; no Cache Storage still signs out.
  try {
    await caches.delete(MEDIA_CACHE);
  } catch {
    // Nothing to forget.
  }
  window.location.assign(target);
}
