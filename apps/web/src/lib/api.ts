export type Me = { id: string; displayName: string };

export async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me", { credentials: "same-origin" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /api/me: ${res.status}`);
  return (await res.json()) as Me;
}

export async function logout(): Promise<void> {
  const res = await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  const { redirectTo } = (await res.json()) as { redirectTo: string };
  window.location.assign(redirectTo);
}
