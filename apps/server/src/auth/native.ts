import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// The iPhone app signs in through a system sheet that ends on this address; the sheet hands the
// URL to the app, and no other app can receive it (iOS registers no scheme for it).
export const NATIVE_CALLBACK = "belay://auth";
// Marks the provider's state as the app's, so a callback that lost its transaction cookie still
// knows where to send the failure.
export const NATIVE_STATE = "n.";
// base64url of a SHA-256: the S256 challenge of the app's own verifier.
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
export const CODE_TTL_MS = 60_000;
export const MAX_PENDING = 1_000;

// Keep the reasons in step with `signin.*` in the web i18n files.
export type SigninFailure = "unavailable" | "expired" | "failed" | "denied";

export const nativeCallback = (q: { code: string } | { error: SigninFailure }) =>
  `${NATIVE_CALLBACK}?${new URLSearchParams(q).toString()}`;

export interface NativeCodes {
  /** A new one-time code for this person, bound to the app's challenge. */
  issue(userId: string, challenge: string, now?: number): string;
  /** The person, or null; the code is spent either way. */
  redeem(code: string, verifier: string, now?: number): string | null;
}

const sha256 = (value: string) => createHash("sha256").update(value);

// ponytail: pending codes live in memory, so one server process per instance. A restart during
// the 60 s only asks for another tap on Sign in. Upgrade: a table of hashed codes.
export function nativeCodes(): NativeCodes {
  // Keyed by the code's hash, so the map never holds a code that could be replayed. A Map keeps
  // insertion order: the first key is the oldest.
  const pending = new Map<string, { userId: string; challenge: string; expires: number }>();
  return {
    issue(userId, challenge, now = Date.now()) {
      for (const [key, entry] of pending) if (entry.expires <= now) pending.delete(key);
      while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
      const code = randomBytes(32).toString("base64url");
      pending.set(sha256(code).digest("hex"), { userId, challenge, expires: now + CODE_TTL_MS });
      return code;
    },
    redeem(code, verifier, now = Date.now()) {
      const key = sha256(code).digest("hex");
      const entry = pending.get(key);
      // Deleted before any check: a wrong verifier spends the code, so it cannot be guessed at.
      pending.delete(key);
      if (!entry || entry.expires <= now) return null;
      const given = Buffer.from(sha256(verifier).digest("base64url"));
      const expected = Buffer.from(entry.challenge);
      return given.length === expected.length && timingSafeEqual(given, expected)
        ? entry.userId
        : null;
    },
  };
}
