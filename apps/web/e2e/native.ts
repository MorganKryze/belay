import type { Page, Request } from "@playwright/test";
import type { HealthAccess, HealthSample } from "../src/native/health";

// The instance the simulated app talks to, answered by routeInstance.
export const INSTANCE = "https://belay.test";

// The page as the iPhone app runs it. CapacitorCustomPlatform names the platform; Capacitor then
// sends each call to a plugin the native side declares (PluginHeaders) through nativePromise, as
// the app's own bridge does, and the fakes answer there. What the native side keeps (the token,
// the address the sheet opened) lives in sessionStorage, so it outlasts a reload as the Keychain
// outlasts a restart. The stored instance and the token are seeded once per tab, so what the app
// writes later is what the next load finds. Given `health`, the app has Apple Health, whose store
// lives in sessionStorage too, as Health outlasts a restart.
export const asIPhone = (page: Page, options: PhoneOptions = {}): Promise<void> =>
  asPhone(page, "ios", options);

// The page as the Android app runs it: the same fakes, the platform named "android".
export const asAndroid = (page: Page, options: PhoneOptions = {}): Promise<void> =>
  asPhone(page, "android", options);

type PhoneOptions = {
  instance?: string | null;
  token?: string | null;
  // The sign-in sheet: closed by the person, or coming back to this address.
  authenticate?: "cancel" | { url: string };
  // Health on this phone: there or not, the write access the system grants once asked (both
  // allowed by default), and the body-mass readings other apps wrote.
  health?: {
    available?: boolean;
    grant?: { workouts: HealthAccess; weighings: HealthAccess };
    samples?: HealthSample[];
  };
};

async function asPhone(
  page: Page,
  platform: "ios" | "android",
  { instance = INSTANCE, token = null, authenticate = "cancel", health }: PhoneOptions,
): Promise<void> {
  await page.addInitScript(
    ({ platform, instance, token, authenticate, health }) => {
      type Kept = { origin: string; token: string };
      const TOKEN = "belay.fake.token";
      if (sessionStorage.getItem("belay.fake.seeded") === null) {
        sessionStorage.setItem("belay.fake.seeded", "1");
        if (instance !== null) {
          localStorage.setItem("belay.instance", instance);
          if (token !== null)
            sessionStorage.setItem(TOKEN, JSON.stringify({ origin: instance, token }));
        }
        if (health)
          sessionStorage.setItem("belay.fake.healthSamples", JSON.stringify(health.samples ?? []));
      }
      const kept = () => JSON.parse(sessionStorage.getItem(TOKEN) ?? "null") as Kept | null;
      const read = <T>(key: string, empty: T): T =>
        JSON.parse(sessionStorage.getItem(key) ?? "null") ?? empty;
      const write = (key: string, value: unknown) =>
        sessionStorage.setItem(key, JSON.stringify(value));
      // Apple Health as the native side answers it, one call per request, every request kept.
      // Undetermined until the page asks to write, then what iOS grants; each object stored or
      // removed under the sync identifier the native side builds, so a second write replaces the
      // first; the readings after the anchor, the anchor being how many were already read.
      type Health = NonNullable<typeof health>;
      type Status = { available: boolean; workouts: HealthAccess; weighings: HealthAccess };
      type HealthObject = Record<string, unknown> & { kind: string };
      function fakeHealth({
        available = true,
        grant = { workouts: "allowed", weighings: "allowed" },
      }: Health) {
        const STATUS = "belay.fake.healthStatus";
        const STORE = "belay.fake.healthStore";
        const status = (): Status =>
          read(STATUS, { available, workouts: "undetermined", weighings: "undetermined" });
        const syncID = (o: HealthObject) =>
          o.kind.startsWith("workout")
            ? `belay-session-${o.id as string}`
            : `belay-weighing-${o.owner as string}-${o.date as string}`;
        const apply = (o: HealthObject) => {
          const access = status()[o.kind.startsWith("workout") ? "workouts" : "weighings"];
          if (access !== "allowed") return "denied";
          const id = syncID(o);
          const removal = o.kind.endsWith("Removed");
          const others = Object.entries(read<Record<string, HealthObject>>(STORE, {})).filter(
            ([key]) => key !== id,
          );
          write(STORE, Object.fromEntries(removal ? others : [...others, [id, o]]));
          return removal ? "removed" : "written";
        };
        return async (request: Record<string, unknown>) => {
          write("belay.fake.healthRequests", [
            ...read<unknown[]>("belay.fake.healthRequests", []),
            request,
          ]);
          switch (request.op) {
            case "status":
              return status();
            case "authorize":
              if (request.scope === "write" && available) write(STATUS, { ...status(), ...grant });
              return status();
            case "apply":
              return { outcomes: (request.objects as HealthObject[]).map(apply) };
            case "readWeighings": {
              const samples = read<HealthSample[]>("belay.fake.healthSamples", []);
              const from = Number(request.anchor ?? "0");
              return {
                samples: samples
                  .slice(from)
                  .filter((s) => s.startedAt >= (request.since as number)),
                anchor: String(samples.length),
              };
            }
            default:
              throw new Error("unknown operation");
          }
        };
      }
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
          ...(health && { health: fakeHealth(health) }),
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
      w.CapacitorCustomPlatform = { name: platform, plugins };
      w.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => platform,
        PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({
          name,
          methods: Object.keys(methods).map((m) => ({ name: m, rtype: "promise" })),
        })),
        nativePromise: (plugin: string, method: string, options: never) =>
          plugins[plugin]![method]!(options),
      };
    },
    { platform, instance, token, authenticate, health },
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

// Every request the app made of Apple Health, in order.
export const healthRequests = (page: Page): Promise<Record<string, unknown>[]> =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("belay.fake.healthRequests") ?? "[]"));

// What Apple Health holds of Belay's, by sync identifier.
export const healthStore = (page: Page): Promise<Record<string, Record<string, unknown>>> =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("belay.fake.healthStore") ?? "{}"));

// A body-mass reading another app (a connected scale) writes to Apple Health.
export const addHealthSample = (page: Page, sample: HealthSample): Promise<void> =>
  page.evaluate((sample) => {
    const key = "belay.fake.healthSamples";
    const samples = JSON.parse(sessionStorage.getItem(key) ?? "[]") as unknown[];
    sessionStorage.setItem(key, JSON.stringify([...samples, sample]));
  }, sample);

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
