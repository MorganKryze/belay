const BASE = "http://belay.invalid";
const MAX_LENGTH = 2048;

// Only a path on our own origin: anything the URL parser resolves elsewhere falls back to "/".
// The normalised OUTPUT is checked too: dot segments turn "/.//evil.example" into "//evil.example",
// which a browser reads as a protocol-relative URL to another host.
// Never throws (URL.parse answers null on garbage such as "/\t/["). The length is capped on both
// sides of the normalisation (percent-encoding expands), so a hostile returnTo cannot bloat the
// signed transaction cookie past what browsers store.
export function safeReturnTo(value: string | undefined): string {
  if (
    !value ||
    value.length > MAX_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  )
    return "/";
  const url = URL.parse(value, BASE);
  if (!url) return "/";
  const path = url.pathname + url.search + url.hash;
  return url.origin === BASE && !path.startsWith("//") && path.length <= MAX_LENGTH ? path : "/";
}
