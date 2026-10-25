import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./index.css";
import { applyTheme, readTheme } from "./lib/theme";
import { startUpdates } from "./lib/update";
import { preloadWhenIdle } from "./lib/idle";
import { markPointer } from "./lib/pointer";
import { isNative } from "./lib/platform";
import { markPresses, settlePresses } from "./lib/press";
import { navKind } from "./lib/transitions";
import { router, TAB_PAGES } from "./router";

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
  applyTheme(readTheme()),
);

startUpdates();
markPresses();
markPointer();
// A row held through its push lets go once the next page is in, and tints again briefly on Back.
router.subscribe("onResolved", ({ fromLocation, toLocation }) =>
  settlePresses(navKind(fromLocation?.pathname, toLocation.pathname, false)),
);

const queryClient = new QueryClient();

function render() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
  // Once the first screen has settled, the tabs' pages load ahead of their first tap: on a slow
  // network a tab then opens at once instead of holding the previous page.
  preloadWhenIdle(TAB_PAGES);
}

// On the phone the session token is read once, before the first request asks for it. If that
// fails the app opens signed out rather than staying on its launch screen. A promise rather than a
// top-level await: with one, the build preloads lazy pages at startup (13 kB more, measured).
if (isNative())
  void import("./native/session")
    .then((m) => m.install())
    .catch(() => {})
    .then(render);
else render();
