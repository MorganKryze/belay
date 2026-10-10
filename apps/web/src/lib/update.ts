import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";

const hour = 60 * 60 * 1000;

let ready = false;
let applyUpdate: (reload?: boolean) => Promise<void> = async () => {};
const listeners = new Set<() => void>();

// Looks for a new service worker at the hour and when the app comes back to the foreground. A
// check offline would only fail, so it is skipped. Returns a function that stops the checks.
export function scheduleUpdateChecks(registration: ServiceWorkerRegistration) {
  const check = () => {
    if (navigator.onLine) void registration.update().catch(() => {});
  };
  const onVisible = () => document.visibilityState === "visible" && check();
  const timer = setInterval(check, hour);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

// Registers the service worker. A new version waits until the user taps "Reload": claiming a
// live page would let cleanupOutdatedCaches delete the lazy chunks it still needs.
export function startUpdates() {
  ready = false;
  applyUpdate = registerSW({
    onNeedRefresh() {
      ready = true;
      for (const notify of listeners) notify();
    },
    onRegisteredSW(_url, registration) {
      if (registration) scheduleUpdateChecks(registration);
    },
  });
}

export const reloadToUpdate = () => void applyUpdate(true);

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export const useUpdateReady = () => useSyncExternalStore(subscribe, () => ready);
