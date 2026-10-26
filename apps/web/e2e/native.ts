import type { Page, Request } from "@playwright/test";

// The instance the simulated app talks to, answered by routeInstance.
export const INSTANCE = "https://belay.test";

// The page as the iPhone app runs it. CapacitorCustomPlatform names the platform; Capacitor then
// sends each call to a plugin the native side declares (PluginHeaders) through nativePromise, as
// the app's own bridge does, and the fakes answer there. What the native side keeps (the token,
// the address the sheet opened) lives in sessionStorage, so it outlasts a reload as the Keychain
// outlasts a restart. The stored instance and the token are seeded once per tab, so what the app
// writes later is what the next load finds.
export async function asIPhone(
  page: Page,
  {
    instance = INSTANCE,
    token = null,
    authenticate = "cancel",
  }: {
    instance?: string | null;
    token?: string | null;
    // The sign-in sheet: closed by the person, or coming back to this address.
    authenticate?: "cancel" | { url: string };
  } = {},
): Promise<void> {
  await page.addInitScript(
    ({ instance, token, authenticate }) => {
      type Kept = { origin: string; token: string };
      const TOKEN = "belay.fake.token";
      if (sessionStorage.getItem("belay.fake.seeded") === null) {
        sessionStorage.setItem("belay.fake.seeded", "1");
        if (instance !== null) {
          localStorage.setItem("belay.instance", instance);
          if (token !== null)
            sessionStorage.setItem(TOKEN, JSON.stringify({ origin: instance, token }));
        }
      }
      const kept = () => JSON.parse(sessionStorage.getItem(TOKEN) ?? "null") as Kept | null;
      const plugins: Record<string, Record<string, (o: never) => Promise<unknown>>> = {
        BelayNative: {
          readToken: async ({ origin }: { origin: string }) => ({
            token: kept()?.origin === origin ? kept()!.token : null,
          }),
          writeToken: async (o: Kept) => sessionStorage.setItem(TOKEN, JSON.stringify(o)),
          clearToken: async () => sessionStorage.removeItem(TOKEN),
          authenticate: async ({ url }: { url: string }) => {
            sessionStorage.setItem("belay.fake.sheet", url);
            if (authenticate === "cancel") {
              throw Object.assign(new Error("cancelled"), { code: "cancelled" });
            }
            return authenticate;
          },
          // What the lock screen shows: the last description, and how many times the app asked.
          setLiveActivity: async ({ activity }: { activity: unknown }) => {
            sessionStorage.setItem("belay.fake.activity", JSON.stringify(activity));
            sessionStorage.setItem(
              "belay.fake.activityCalls",
              String(Number(sessionStorage.getItem("belay.fake.activityCalls") ?? "0") + 1),
            );
          },
        },
        Haptics: { notification: async () => {} },
        LocalNotifications: {
          checkPermissions: async () => ({ display: "granted" }),
          requestPermissions: async () => ({ display: "granted" }),
          schedule: async () => ({ notifications: [] }),
          cancel: async () => {},
        },
      };
      const w = window as unknown as Record<string, unknown>;
      w.CapacitorCustomPlatform = { name: "ios", plugins };
      w.Capacitor = {
        isNativePlatform: () => true,
        PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({
          name,
          methods: Object.keys(methods).map((m) => ({ name: m, rtype: "promise" })),
        })),
        nativePromise: (plugin: string, method: string, options: never) =>
          plugins[plugin]![method]!(options),
      };
    },
    { instance, token, authenticate },
  );
}

// The address the sign-in sheet was last opened at, or null.
export const sheetOpenedAt = (page: Page): Promise<string | null> =>
  page.evaluate(() => sessionStorage.getItem("belay.fake.sheet"));

// What iOS would show on the lock screen: the last description the app sent, null once it asked
// for none, undefined when it never asked.
export const shownActivity = (
  page: Page,
): Promise<
  { workoutId: string; staleAt: number; state: Record<string, unknown> } | null | undefined
> =>
  page.evaluate(() => {
    const kept = sessionStorage.getItem("belay.fake.activity");
    return kept === null ? undefined : JSON.parse(kept);
  });

// How many times the app has asked iOS to show, update or end the Activity.
export const activityCalls = (page: Page): Promise<number> =>
  page.evaluate(() => Number(sessionStorage.getItem("belay.fake.activityCalls") ?? "0"));

type Answer = { status?: number; json?: unknown; body?: string; contentType?: string } | "abort";
type Handler = Answer | ((request: Request) => Answer | Promise<Answer>);

// The instance at INSTANCE: each request answered by the handler of "METHOD /path" or "/path",
// anything else 404. The app asks from another origin, so every answer allows it, preflights
// included.
export async function routeInstance(page: Page, handlers: Record<string, Handler>): Promise<void> {
  const cors = { "access-control-allow-origin": "*" };
  await page.route(`${INSTANCE}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          ...cors,
          "access-control-allow-headers": "authorization, content-type",
          "access-control-allow-methods": "GET, HEAD, POST",
        },
      });
    }
    const { pathname } = new URL(request.url());
    const handler = handlers[`${request.method()} ${pathname}`] ?? handlers[pathname];
    const answer = typeof handler === "function" ? await handler(request) : handler;
    if (answer === "abort") return route.abort();
    const { status = answer ? 200 : 404, json, body, contentType } = answer ?? {};
    return route.fulfill({
      status,
      headers: cors,
      ...(json !== undefined ? { json } : { body: body ?? "" }),
      ...(contentType && { contentType }),
    });
  });
}
