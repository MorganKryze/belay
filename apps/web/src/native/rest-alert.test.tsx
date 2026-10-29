import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ActiveSession } from "@/sync/db";
import type { OpenAccount } from "@/sync/account";

type Note = { id: number; schedule?: { at: Date }; [field: string]: unknown };
type Display = "granted" | "denied" | "prompt";

// The phone's pending notifications as iOS keeps them: one per id, a new one replacing the old.
// `shown` holds those already delivered, which a cancel leaves in place on Android. `calls` keeps
// the order the plugin heard cancels, removals and schedules in.
const { notes, pending, shown, view, unschedule, calls, phone } = vi.hoisted(() => {
  const pending = new Map<number, Note>();
  const shown = new Map<number, Note>();
  const calls: string[] = [];
  const unschedule = async ({ notifications }: { notifications: { id: number }[] }) => {
    calls.push("cancel");
    for (const n of notifications) pending.delete(n.id);
  };
  const notes = {
    schedule: vi.fn(async ({ notifications }: { notifications: Note[] }) => {
      calls.push("schedule");
      for (const n of notifications) pending.set(n.id, n);
      return { notifications: notifications.map((n) => ({ id: n.id })) };
    }),
    cancel: vi.fn(unschedule),
    removeDeliveredNotificationsById: vi.fn(async ({ ids }: { ids: number[] }) => {
      calls.push("remove");
      for (const id of ids) shown.delete(id);
    }),
    checkPermissions: vi.fn(async (): Promise<{ display: Display }> => ({ display: "granted" })),
    requestPermissions: vi.fn(async (): Promise<{ display: Display }> => ({ display: "granted" })),
    // Capacitor's plugin proxy answers any other name with a method that throws, then included:
    // a promise resolved with the plugin would call it and never settle.
    then: () => {
      throw new Error('"LocalNotifications.then()" is not implemented on ios');
    },
  };
  return {
    notes,
    pending,
    shown,
    unschedule,
    calls,
    view: { active: null as ActiveSession | null },
    phone: { platform: "ios" as "ios" | "android" },
  };
});
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: notes }));
// The Health link has its own tests; here only whether it is there.
vi.mock("./health-mirror", () => ({ HealthMirror: () => <i data-testid="health-mirror" /> }));
vi.mock("@/lib/platform", async (original) => ({
  ...(await original<typeof import("@/lib/platform")>()),
  nativePlatform: () => phone.platform,
}));
// The lock screen's description has its own tests: here only when it is sent again.
const { resend } = vi.hoisted(() => ({ resend: vi.fn() }));
vi.mock("./live-activity", async (original) => ({
  ...(await original<typeof import("./live-activity")>()),
  resendLiveActivity: resend,
}));
vi.mock("@/sync/account", () => ({
  useSessionView: () => ({ data: { active: view.active } }),
  useHistory: () => ({ data: {} }),
}));

import { NativeRestAlert, restAlertAt } from "./rest-alert";

const NOW = Date.parse("2026-10-28T18:00:00.000Z");
const at = (s: number) => new Date(NOW + s * 1000).toISOString();
const W = "0192c3a0-0000-7000-8000-000000000001";
const rest = (endsIn: number | null, more: Partial<ActiveSession> = {}): ActiveSession => ({
  workoutId: W,
  slotIndex: 0,
  restEndsAt: endsIn === null ? null : at(endsIn),
  ...more,
});
const account = { kind: "open" } as OpenAccount;
const show = (active: ActiveSession | null) => {
  view.active = active;
  return <NativeRestAlert account={account} session={null} />;
};
const only = () => {
  expect(pending.size).toBe(1);
  return pending.get(1)!;
};

// Whether the app is on screen, as the web view reports it to the page.
let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
const setVisible = (shown: boolean) => {
  visibility = shown ? "visible" : "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
};
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  localStorage.clear();
  pending.clear();
  shown.clear();
  calls.length = 0;
  phone.platform = "ios";
  visibility = "visible";
  vi.clearAllMocks();
  notes.checkPermissions.mockResolvedValue({ display: "granted" });
  notes.requestPermissions.mockResolvedValue({ display: "granted" });
  notes.cancel.mockImplementation(unschedule);
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  await i18n.changeLanguage("fr");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("restAlertAt", () => {
  it("is the end of a running rest; null without one, past its end, or frozen by a stopping pause; the end when the pause lets the rest run", () => {
    expect(restAlertAt(rest(90), "all", NOW)).toBe(at(90));
    expect(restAlertAt(rest(null), "all", NOW)).toBeNull();
    expect(restAlertAt(null, "all", NOW)).toBeNull();
    expect(restAlertAt(undefined, "all", NOW)).toBeNull();
    expect(restAlertAt(rest(0), "all", NOW)).toBeNull();
    expect(restAlertAt(rest(-5), "all", NOW)).toBeNull();
    expect(restAlertAt(rest(90, { pausedAt: at(-10) }), "all", NOW)).toBeNull();
    expect(restAlertAt(rest(90, { pausedAt: at(-10) }), "session", NOW)).toBe(at(90));
    expect(restAlertAt(rest(90, { pausedAt: null }), "all", NOW)).toBe(at(90));
  });
});

describe("NativeRestAlert", () => {
  it("a rest schedules one notification at its end, silent in the foreground, with the tone", async () => {
    localStorage.setItem("belay.restSound", "on");
    render(show(rest(90)));
    await waitFor(() => expect(notes.schedule).toHaveBeenCalledTimes(1));
    expect(only()).toEqual({
      id: 1,
      title: "Repos terminé",
      body: "C’est reparti",
      schedule: { at: new Date(at(90)) },
      silent: true,
      sound: "rest.wav",
    });
  });

  it("the sound off schedules it with no sound", async () => {
    localStorage.setItem("belay.restSound", "off");
    render(show(rest(90)));
    await waitFor(() => expect(pending.size).toBe(1));
    expect(only()).not.toHaveProperty("sound");
    expect(only().silent).toBe(true);
  });

  it("+30 s moves it (same id)", async () => {
    const { rerender } = render(show(rest(90)));
    await waitFor(() => expect(pending.size).toBe(1));
    rerender(show(rest(120)));
    await waitFor(() => expect(only().schedule).toEqual({ at: new Date(at(120)) }));
    expect(only().id).toBe(1);
  });

  it("a skipped rest cancels it", async () => {
    const { rerender } = render(show(rest(90)));
    await waitFor(() => expect(pending.size).toBe(1));
    rerender(show(rest(null)));
    await waitFor(() => expect(pending.size).toBe(0));
  });

  it("a pause that stops everything cancels it and the resume schedules the new end", async () => {
    const { rerender } = render(show(rest(90)));
    await waitFor(() => expect(pending.size).toBe(1));
    rerender(show(rest(90, { pausedAt: at(0) })));
    await waitFor(() => expect(pending.size).toBe(0));
    vi.setSystemTime(NOW + 60_000);
    rerender(show(rest(150, { pausedAt: null })));
    await waitFor(() => expect(only().schedule).toEqual({ at: new Date(at(150)) }));
  });

  it("a pause that stops only the session leaves it pending", async () => {
    localStorage.setItem("belay.pauseStops", "session");
    const { rerender } = render(show(rest(90)));
    await waitFor(() => expect(pending.size).toBe(1));
    rerender(show(rest(90, { pausedAt: at(0) })));
    await new Promise((r) => setTimeout(r, 20));
    expect(only().schedule).toEqual({ at: new Date(at(90)) });
  });

  it("the session ending cancels it", async () => {
    const { rerender } = render(show(rest(90)));
    await waitFor(() => expect(pending.size).toBe(1));
    rerender(show(null));
    await waitFor(() => expect(pending.size).toBe(0));
  });

  it("unmounting (sign-out) cancels it", async () => {
    const { unmount } = render(show(rest(90)));
    await waitFor(() => expect(pending.size).toBe(1));
    unmount();
    await waitFor(() => expect(pending.size).toBe(0));
  });

  it("the page after a sign-out, with no open account, cancels what the last one left pending", async () => {
    // The reload leaves nothing to unmount: iOS still holds the last schedule.
    pending.set(1, { id: 1, schedule: { at: new Date(at(90)) } });
    render(<NativeRestAlert account={{ kind: "signed-out", unreachable: false }} session={null} />);
    await waitFor(() => expect(pending.size).toBe(0));
    expect(notes.checkPermissions).not.toHaveBeenCalled();
  });

  it("the first open session asks iOS once; a refusal schedules nothing", async () => {
    notes.checkPermissions.mockResolvedValue({ display: "prompt" });
    notes.requestPermissions.mockResolvedValue({ display: "denied" });
    const { rerender } = render(show(null));
    await new Promise((r) => setTimeout(r, 20));
    expect(notes.checkPermissions).not.toHaveBeenCalled();
    rerender(show(rest(90)));
    await waitFor(() => expect(notes.requestPermissions).toHaveBeenCalledTimes(1));
    rerender(show(rest(120)));
    rerender(show(rest(150, { workoutId: "0192c3a0-0000-7000-8000-000000000002" })));
    await new Promise((r) => setTimeout(r, 20));
    expect(notes.checkPermissions).toHaveBeenCalledTimes(1);
    expect(notes.requestPermissions).toHaveBeenCalledTimes(1);
    expect(notes.schedule).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });

  it("a granted prompt schedules the rest under way", async () => {
    notes.checkPermissions.mockResolvedValue({ display: "prompt" });
    render(show(rest(90)));
    await waitFor(() => expect(only().schedule).toEqual({ at: new Date(at(90)) }));
    expect(notes.requestPermissions).toHaveBeenCalledTimes(1);
    // The iPhone's lock screen does not hang on the notification permission.
    expect(resend).not.toHaveBeenCalled();
  });

  it("an open account mounts the Health link, a signed-out one does not", async () => {
    render(show(null));
    await screen.findByTestId("health-mirror");
    cleanup();
    render(<NativeRestAlert account={{ kind: "signed-out", unreachable: false }} session={null} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("health-mirror")).toBeNull();
  });

  it("a refusal asks nothing more and a missing plugin changes nothing for the person", async () => {
    notes.checkPermissions.mockResolvedValue({ display: "denied" });
    const { rerender } = render(show(rest(90)));
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(1));
    rerender(show(rest(120)));
    await new Promise((r) => setTimeout(r, 20));
    expect(notes.requestPermissions).not.toHaveBeenCalled();
    expect(notes.schedule).not.toHaveBeenCalled();
    cleanup();

    notes.checkPermissions.mockRejectedValue(new Error("not implemented"));
    notes.cancel.mockRejectedValue(new Error("not implemented"));
    const { unmount } = render(show(rest(90)));
    await new Promise((r) => setTimeout(r, 20));
    expect(notes.schedule).not.toHaveBeenCalled();
    unmount();
  });
});

describe("NativeRestAlert on Android", () => {
  beforeEach(() => {
    phone.platform = "android";
  });

  it("android: nothing pending while shown", async () => {
    render(show(rest(90)));
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(1));
    await settle();
    expect(notes.cancel).toHaveBeenCalled();
    expect(notes.schedule).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });

  it("android: hiding schedules the end on the rest channel", async () => {
    localStorage.setItem("belay.restSound", "on");
    render(show(rest(90)));
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(1));
    await settle();
    setVisible(false);
    await waitFor(() => expect(notes.schedule).toHaveBeenCalledTimes(1));
    expect(only()).toMatchObject({
      id: 1,
      title: "Repos terminé",
      body: "C’est reparti",
      channelId: "rest",
      schedule: { at: new Date(at(90)), allowWhileIdle: true },
    });
  });

  it("android: sound off uses the quiet channel", async () => {
    localStorage.setItem("belay.restSound", "off");
    render(show(rest(90)));
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(1));
    await settle();
    setVisible(false);
    await waitFor(() => expect(pending.size).toBe(1));
    expect(only().channelId).toBe("rest-quiet");
  });

  it("android: showing again cancels", async () => {
    render(show(rest(90)));
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(1));
    await settle();
    setVisible(false);
    await waitFor(() => expect(pending.size).toBe(1));
    setVisible(true);
    await waitFor(() => expect(pending.size).toBe(0));
  });

  it("android: showing again removes an alert already shown", async () => {
    render(show(rest(90)));
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(1));
    await settle();
    setVisible(false);
    await waitFor(() => expect(pending.size).toBe(1));
    // The rest ends with the app hidden: Android posts the alert.
    shown.set(1, only());
    pending.clear();
    setVisible(true);
    await waitFor(() => expect(shown.size).toBe(0));
    expect(pending.size).toBe(0);
  });

  it("android: the session ending removes an alert already shown", async () => {
    const { rerender } = render(show(rest(90)));
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(1));
    await settle();
    shown.set(1, { id: 1 });
    rerender(show(null));
    await waitFor(() => expect(shown.size).toBe(0));
  });

  it("android: hide, show, hide leaves one pending", async () => {
    render(show(rest(90)));
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(1));
    await settle();
    calls.length = 0;
    setVisible(false);
    await settle();
    setVisible(true);
    await settle();
    setVisible(false);
    await waitFor(() =>
      expect(calls).toEqual([
        "cancel",
        "remove",
        "schedule",
        "cancel",
        "remove",
        "cancel",
        "remove",
        "schedule",
      ]),
    );
    expect(only().schedule).toEqual({ at: new Date(at(90)), allowWhileIdle: true });
  });

  it("android: notifications allowed in the settings meanwhile schedule the next rest", async () => {
    notes.checkPermissions.mockResolvedValue({ display: "prompt" });
    notes.requestPermissions.mockResolvedValue({ display: "denied" });
    render(show(rest(90)));
    await waitFor(() => expect(notes.requestPermissions).toHaveBeenCalledTimes(1));
    await settle();
    // Off to Android's settings, where the person allows notifications, then back.
    setVisible(false);
    await settle();
    expect(notes.schedule).not.toHaveBeenCalled();
    notes.checkPermissions.mockResolvedValue({ display: "granted" });
    setVisible(true);
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(2));
    await settle();
    expect(resend).toHaveBeenCalledTimes(1);
    setVisible(false);
    await waitFor(() =>
      expect(only().schedule).toEqual({ at: new Date(at(90)), allowWhileIdle: true }),
    );
    expect(notes.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it("android: a grant at the prompt sends the session's description again", async () => {
    notes.checkPermissions.mockResolvedValue({ display: "prompt" });
    render(show(rest(90)));
    await waitFor(() => expect(resend).toHaveBeenCalledTimes(1));
    await settle();
    expect(resend).toHaveBeenCalledTimes(1);
  });

  it("android: notifications turned off in the settings meanwhile schedule nothing more", async () => {
    render(show(rest(90)));
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(1));
    await settle();
    setVisible(false);
    await waitFor(() => expect(pending.size).toBe(1));
    notes.checkPermissions.mockResolvedValue({ display: "denied" });
    setVisible(true);
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(2));
    await settle();
    setVisible(false);
    await settle();
    expect(notes.schedule).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
  });

  it("android: notifications already allowed send nothing again", async () => {
    render(show(rest(90)));
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(1));
    setVisible(false);
    await settle();
    setVisible(true);
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(2));
    await settle();
    expect(resend).not.toHaveBeenCalled();
  });

  it("android: no schedule for a rest already over", async () => {
    const { rerender } = render(show(rest(90)));
    await waitFor(() => expect(notes.checkPermissions).toHaveBeenCalledTimes(1));
    await settle();
    vi.setSystemTime(NOW + 120_000);
    rerender(show(rest(90)));
    setVisible(false);
    await settle();
    expect(notes.schedule).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });
});
