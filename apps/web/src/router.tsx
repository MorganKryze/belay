import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { Home } from "./routes/home";
import { Layout } from "./routes/layout";

// ponytail: code-based routes; switch to file-based routing once there are more than ~10 screens.
const rootRoute = createRootRoute({ component: Layout });
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
  // Only the shape: Home decides which reasons it knows and ignores the rest.
  validateSearch: (search: Record<string, unknown>): { signin?: string } =>
    typeof search.signin === "string" ? { signin: search.signin } : {},
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  // Radix Select leaves the initial chunk; Home stays eager because it is the landing screen.
  component: lazyRouteComponent(() => import("./routes/settings"), "Settings"),
});

export const routeTree = rootRoute.addChildren([homeRoute, settingsRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
