import { isToolId, type ToolId } from "@belay/shared/tools/catalog";
import { isSessionCode } from "@belay/shared/training/workout";
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  type RouterHistory,
} from "@tanstack/react-router";
// Loaded before the router is created: its capture listener sees a back swipe before the router
// handles that popstate.
import { viewTransition } from "./lib/transitions";
import { trackEntries } from "./lib/back";
import { NotFound, Pending, RouteError } from "./routes/fallbacks";
import { Home } from "./routes/home";
import { Layout } from "./routes/layout";
import { isWorkoutTab, type WorkoutTab } from "./workouts/tabs";

// ponytail: code-based routes, 20 screens today (the tools share one lazy `$toolId` route).
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
// The tabs' pages, lazy, and fetched ahead once the first screen has settled (main.tsx).
const workoutsPage = lazyRouteComponent(() => import("./routes/workouts"), "Workouts");
const bodyPage = lazyRouteComponent(() => import("./routes/body"), "Body");
const toolsPage = lazyRouteComponent(() => import("./routes/tools"), "Tools");
export const TAB_PAGES = [workoutsPage, bodyPage, toolsPage];
// Body is lazy (its chart and history are not needed to weigh in from Home).
const bodyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/body",
  component: bodyPage,
});
// The Sessions tab: its segment travels in the URL, so a link can open one (?tab=program).
const workoutsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workouts",
  component: workoutsPage,
  validateSearch: (search: Record<string, unknown>): { tab?: WorkoutTab } =>
    isWorkoutTab(search.tab) ? { tab: search.tab } : {},
});
const workoutDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workouts/$workoutId",
  component: lazyRouteComponent(() => import("./routes/workout-detail"), "WorkoutDetail"),
});
// The session screen, full screen. ?start=B starts session B, or takes up the one open.
const workoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workout",
  component: lazyRouteComponent(() => import("./routes/workout"), "WorkoutScreen"),
  validateSearch: (search: Record<string, unknown>): { start?: string } =>
    typeof search.start === "string" ? { start: search.start } : {},
});
// The editor, full screen: a finished session corrected (?id=), or one logged afterwards
// (?code=B&date=2026-10-09&minutes=60). Only the shapes here; the editor checks the values.
type EditorSearch = { id?: string; code?: string; date?: string; minutes?: number };
const workoutEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workout/edit",
  component: lazyRouteComponent(() => import("./routes/workout-editor"), "WorkoutEditor"),
  validateSearch: (search: Record<string, unknown>): EditorSearch => ({
    ...(typeof search.id === "string" ? { id: search.id } : {}),
    ...(typeof search.code === "string" && isSessionCode(search.code) ? { code: search.code } : {}),
    ...(typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
      ? { date: search.date }
      : {}),
    ...(typeof search.minutes === "number" &&
    Number.isInteger(search.minutes) &&
    search.minutes >= 5 &&
    search.minutes <= 480
      ? { minutes: search.minutes }
      : {}),
  }),
});
const workoutSummaryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workout/summary/$workoutId",
  component: lazyRouteComponent(() => import("./routes/workout-summary"), "WorkoutSummary"),
});
const exerciseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/exercises/$exerciseId",
  component: lazyRouteComponent(() => import("./routes/exercise"), "ExercisePage"),
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  // Radix Select leaves the initial chunk; Home stays eager because it is the landing screen.
  component: lazyRouteComponent(() => import("./routes/settings"), "Settings"),
});
const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/profile",
  component: lazyRouteComponent(() => import("./routes/profile"), "Profile"),
});
const supplementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/supplements",
  component: lazyRouteComponent(() => import("./routes/supplements"), "Supplements"),
});
const toolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools",
  component: toolsPage,
});
// Static segments outrank $toolId, so this is never read as a tool id.
const equipmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools/plates/equipment",
  component: lazyRouteComponent(() => import("./routes/tools/equipment"), "Equipment"),
});
const toolChunk = () => import("./routes/tools/tool");
const toolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools/$toolId",
  beforeLoad: ({ params }) => {
    if (!isToolId(params.toolId)) throw notFound();
  },
  loader: ({ params }) => toolChunk().then((m) => m.loadToolPage(params.toolId as ToolId)),
  component: lazyRouteComponent(toolChunk, "Tool"),
});

export const routeTree = rootRoute.addChildren([
  homeRoute,
  workoutsRoute,
  workoutDetailRoute,
  workoutRoute,
  workoutEditorRoute,
  workoutSummaryRoute,
  exerciseRoute,
  bodyRoute,
  settingsRoute,
  profileRoute,
  supplementsRoute,
  toolsRoute,
  equipmentRoute,
  toolRoute,
]);

// Localized not-found and error screens for every route (tests build their own router here).
export const createAppRouter = (history?: RouterHistory) => {
  const router = createRouter({
    routeTree,
    history,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
    defaultViewTransition: viewTransition,
    // A pushed page opens at its top, Back finds the page where it was left, and a tab opened
    // from the bar is a new entry, so it starts at its top too.
    scrollRestoration: true,
    // A link starts loading its page when a finger lands on it or a pointer hovers it, so the
    // tap rarely waits on the network.
    defaultPreload: "intent",
    // A page whose code or data is late shows the breathing mark, never before 150 ms, so a page
    // that is ready by then does not flash it, and once shown for at least 400 ms, so it does not
    // flicker.
    defaultPendingComponent: Pending,
    defaultPendingMs: 150,
    defaultPendingMinMs: 400,
  });
  // The back chevrons read it to go back rather than stack the page they name.
  trackEntries(router.history);
  return router;
};
export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
