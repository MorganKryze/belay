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

// Asked of the stored instance while signed in. An instance that does not answer holds nothing:
// the sync itself then says it is offline.
export async function askVersionGap(origin: string): Promise<VersionGap | null> {
  try {
    const res = await fetch(`${origin}/api/instance`, {
      credentials: "omit",
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = res.ok ? await res.json() : null;
    if (typeof body !== "object" || body === null) return null;
    return versionGap((body as Record<string, unknown>).api) ?? null;
  } catch {
    return null;
  }
}
