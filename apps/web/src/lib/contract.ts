// The instance's sync contract against this build's: the same rule the iPhone app applies.
import { API_VERSION } from "@belay/shared/sync/limits";

export type VersionGap = "instance-ahead" | "instance-behind";

// Undefined for an answer that is not a whole number: no Belay instance answers that. Any other
// whole number is a Belay instance, an earlier one below this build's, 0 included; null when it
// runs this build's version.
export function versionGap(api: unknown, ours = API_VERSION): VersionGap | null | undefined {
  if (typeof api !== "number" || !Number.isInteger(api)) return undefined;
  return api === ours ? null : api > ours ? "instance-ahead" : "instance-behind";
}

// Asked of the stored instance while signed in: null when it runs this build's version,
// "unreached" when no Belay instance answered, which neither holds nor releases the sync.
export async function askVersionGap(origin: string): Promise<VersionGap | null | "unreached"> {
  try {
    const res = await fetch(`${origin}/api/instance`, {
      credentials: "omit",
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = res.ok ? await res.json() : null;
    if (typeof body !== "object" || body === null) return "unreached";
    const gap = versionGap((body as Record<string, unknown>).api);
    return gap === undefined ? "unreached" : gap;
  } catch {
    return "unreached";
  }
}
