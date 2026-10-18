import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./index.css";
import { applyTheme, readTheme } from "./lib/theme";
import { startUpdates } from "./lib/update";
import { preloadWhenIdle } from "./lib/idle";
import { markPresses } from "./lib/press";
import { router, TAB_PAGES } from "./router";

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
  applyTheme(readTheme()),
);

startUpdates();
markPresses();

const queryClient = new QueryClient();

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
