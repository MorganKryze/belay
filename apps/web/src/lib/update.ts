import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";
import { isNative } from "./platform";

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

// Registers the service worker. A new version waits until the user taps "Reload": activating it
// under a live page would let its precache drop the old lazy chunks that page still needs.
// The iPhone app carries its own copy of the web app and updates with the app: no service worker
// there (WebKit in an app runs one only for domains listed when the app is built).
export function startUpdates() {
  if (isNative()) return;
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
