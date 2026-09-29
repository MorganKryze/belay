const BASE = "http://belay.invalid";

// Only a path on our own origin: anything the URL parser resolves elsewhere falls back to "/".
export function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return "/";
  const url = new URL(value, BASE);
  return url.origin === BASE ? url.pathname + url.search + url.hash : "/";
}
