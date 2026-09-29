import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Home } from "./routes/home";
import { Layout } from "./routes/layout";
import { Settings } from "./routes/settings";

// ponytail: code-based routes; switch to file-based routing once there are more than ~10 screens.
const rootRoute = createRootRoute({ component: Layout });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: Settings,
});

export const routeTree = rootRoute.addChildren([homeRoute, settingsRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
