import { isToolId } from "@belay/shared/tools/catalog";
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  type RouterHistory,
} from "@tanstack/react-router";
import { NotFound, RouteError } from "./routes/fallbacks";
import { Home } from "./routes/home";
import { Layout } from "./routes/layout";

// ponytail: code-based routes, 12 screens today (the tools share one lazy `$toolId` route).
// Switch to file-based routing at ~20 screens, or when this file passes ~150 lines of route
// declarations.
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
const toolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools",
  component: lazyRouteComponent(() => import("./routes/tools"), "Tools"),
});
// Static segments outrank $toolId, so this is never read as a tool id.
const equipmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools/plates/equipment",
  component: lazyRouteComponent(() => import("./routes/tools/equipment"), "Equipment"),
});
const toolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools/$toolId",
  beforeLoad: ({ params }) => {
    if (!isToolId(params.toolId)) throw notFound();
  },
  component: lazyRouteComponent(() => import("./routes/tools/tool"), "Tool"),
});

export const routeTree = rootRoute.addChildren([
  homeRoute,
  settingsRoute,
  toolsRoute,
  equipmentRoute,
  toolRoute,
]);

// Localized not-found and error screens for every route (tests build their own router here).
export const createAppRouter = (history?: RouterHistory) =>
  createRouter({
    routeTree,
    history,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
  });
export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
