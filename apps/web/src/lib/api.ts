export type Me = { id: string; displayName: string };

export async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me", { credentials: "same-origin" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /api/me: ${res.status}`);
  return (await res.json()) as Me;
}

// Throws (and never navigates) on any failure, so the caller can tell the user.
export async function logout(): Promise<void> {
  const res = await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  if (!res.ok) throw new Error(`POST /auth/logout: ${res.status}`);
  const body: unknown = await res.json().catch(() => null);
  const redirectTo =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>).redirectTo
      : undefined;
  if (typeof redirectTo !== "string" || redirectTo === "") {
    throw new Error("POST /auth/logout: response has no redirectTo");
  }
  window.location.assign(redirectTo);
}
