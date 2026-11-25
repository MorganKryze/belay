// The iPhone app's own native calls. A module of its own, so the rest alert reaches the plugin
// without importing the sign-in, which the shell loads by itself before the first render: shared
// between the two, the sign-in would cost the startup bundle a few more bytes.
import { registerPlugin } from "@capacitor/core";
import type { HealthRequest } from "./health";
import type { LiveActivity } from "./live-activity";

export interface BelayNativePlugin {
  readToken(o: { origin: string }): Promise<{ token: string | null }>;
  writeToken(o: { origin: string; token: string }): Promise<void>;
  clearToken(): Promise<void>;
  // Rejects with code "cancelled" when the person closes the sheet.
  authenticate(o: { url: string; callbackScheme: string }): Promise<{ url: string }>;
  // Shows, updates or ends the open session on the lock screen; resolves once iOS has applied it.
  setLiveActivity(o: { activity: LiveActivity | null }): Promise<void>;
  // Apple Health, one operation per call (native/health.ts types each answer).
  health(request: HealthRequest): Promise<unknown>;
}

export const BelayNative = registerPlugin<BelayNativePlugin>("BelayNative");
