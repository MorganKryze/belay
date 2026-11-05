// The iPhone's edge swipe is the web view's own back gesture, which knows nothing of the page: it
// would leave a sheet's page under the sheet, or the session behind a wet thumb. So the page turns
// it on only while a pushed page is on top, from the same answer Android's Back reads.
import { nativePlatform } from "@/lib/platform";
import { topOfStack } from "./back";
import { BelayNative } from "./plugin";

// What the watcher needs of the router, so a test can hand it a fake one.
export interface SwipeRouter {
  state: { location: { pathname: string } };
  subscribe(event: "onResolved", fn: () => void): unknown;
}

export function watchSwipeBack(router: SwipeRouter): void {
  // Android's Back asks the page by its own path.
  if (nativePlatform() !== "ios") return;
  // Unknown at start: the web view keeps its gesture through a reload, so a sign-in that reloads
  // home from a pushed page would find it still on. The first sync always says what it wants.
  let enabled: boolean | undefined;
  const sync = () => {
    const wanted = topOfStack(router.state.location.pathname) === "page";
    if (wanted === enabled) return;
    const before = enabled;
    enabled = wanted;
    // Refused, the shell keeps its last state: the next change is measured from there.
    BelayNative.setSwipeBack({ enabled: wanted }).catch(() => {
      if (enabled === wanted) enabled = before;
    });
  };
  // A sheet, menu or list opens or closes by Radix adding, removing or restating its layer.
  new MutationObserver(sync).observe(document.body, {
    childList: true,
    subtree: true,
    attributeFilter: ["data-state"],
  });
  router.subscribe("onResolved", sync);
  sync();
}
