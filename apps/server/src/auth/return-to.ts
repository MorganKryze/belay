const BASE = "http://belay.invalid";

// Only a path on our own origin: anything the URL parser resolves elsewhere falls back to "/".
// The normalised OUTPUT is checked too: dot segments turn "/.//evil.example" into "//evil.example",
// which a browser reads as a protocol-relative URL to another host.
export function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return "/";
  const url = new URL(value, BASE);
  const path = url.pathname + url.search + url.hash;
  return url.origin === BASE && !path.startsWith("//") ? path : "/";
}
