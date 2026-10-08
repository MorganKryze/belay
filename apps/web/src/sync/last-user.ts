// The account this device last signed in with, so the app opens it offline. Signing out clears
// it; the account's database stays (D3) and comes back with the next sign-in to that account.
export type LastUser = { id: string; displayName: string };
const KEY = "belay.lastUser";

export function readLastUser(): LastUser | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof v !== "object" || v === null) return null;
    const { id, displayName } = v as Record<string, unknown>;
    return typeof id === "string" && typeof displayName === "string" ? { id, displayName } : null;
  } catch {
    return null; // no storage (private mode) or unreadable JSON: no account to reopen
  }
}

export function writeLastUser({ id, displayName }: LastUser): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ id, displayName }));
  } catch {
    // Private mode: the account opens online only.
  }
}

export function clearLastUser(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
}
