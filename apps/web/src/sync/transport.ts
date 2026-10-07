import { type SyncRequest, SyncResponseSchema } from "@belay/shared/sync/schema";
import type { SendResult } from "./engine";

// A request that hangs (a captive portal at the gym) would hold the sync lock for good.
const TIMEOUT_MS = 20_000;

export async function postSync(request: SyncRequest): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch("/api/sync", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: "offline" };
  }
  // 409: the browser's session now belongs to another account. Either way, sign in again.
  if (res.status === 401 || res.status === 409) return { kind: "expired" };
  if (!res.ok) return { kind: "failed" };
  const parsed = SyncResponseSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { kind: "ok", response: parsed.data } : { kind: "failed" };
}
