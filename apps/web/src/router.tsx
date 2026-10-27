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
import { navKind, viewTransition } from "./lib/transitions";
import { trackEntries } from "./lib/back";
import { isNative } from "./lib/platform";
import { NotFound, Pending, RouteError } from "./routes/fallbacks";
import { Home } from "./routes/home";
import { Layout } from "./routes/layout";
import { isWorkoutTab, type WorkoutTab } from "./workouts/tabs";

// ponytail: code-based routes, 21 screens today (the tools share one lazy `$toolId` route).
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
  // The history's month rides in the address, so Back from a session lands on it again.
  validateSearch: (search: Record<string, unknown>): { tab?: WorkoutTab; month?: string } => ({
    ...(isWorkoutTab(search.tab) && { tab: search.tab }),
    ...(typeof search.month === "string" &&
      /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month) && { month: search.month }),
  }),
});
// A session of the program before it starts. Opened from Accueil it says so (?from=home), so
// its back chevron and the lit tab stay Accueil's, after a reload too. The code is a letter or a
// session's id, lower case as ids are written; only the shape here: which sessions the account
// holds is read on the phone, so the page says when it lacks one.
const sessionPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workouts/session/$code",
  beforeLoad: ({ params }) => {
    if (
      !isSessionCode(params.code) &&
      !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(params.code)
    )
      throw notFound();
  },
  component: lazyRouteComponent(() => import("./routes/session-preview"), "SessionPreview"),
  validateSearch: (search: Record<string, unknown>): { from?: "home" } =>
    search.from === "home" ? { from: "home" } : {},
});
// The program editor, a computer's page. Static, so it wins over $workoutId.
const programEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workouts/program",
  component: lazyRouteComponent(() => import("./routes/program-editor"), "ProgramEditor"),
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
  // Opened from a session's preview (?session=A, and from=home when that preview came from
  // Accueil), it leads back there.
  validateSearch: (search: Record<string, unknown>): { session?: string; from?: "home" } => {
    const session =
      typeof search.session === "string" && isSessionCode(search.session)
        ? search.session
        : undefined;
    return { ...(session && { session }), ...(search.from === "home" && { from: "home" }) };
  },
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
// Apple Health exists in the iPhone app only: in a browser the page is not found.
const healthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/health",
  beforeLoad: () => {
    if (!isNative()) throw notFound();
  },
  component: lazyRouteComponent(() => import("./routes/health"), "HealthPage"),
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
  sessionPreviewRoute,
  programEditorRoute,
  workoutDetailRoute,
  workoutRoute,
  workoutEditorRoute,
  workoutSummaryRoute,
  exerciseRoute,
  bodyRoute,
  settingsRoute,
  profileRoute,
  supplementsRoute,
  healthRoute,
  toolsRoute,
  equipmentRoute,
  toolRoute,
]);

const PENDING_MS = 150;

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
    defaultPendingMs: PENDING_MS,
    defaultPendingMinMs: 400,
  });
  // The breathing mark takes the place of the page left, which drops that page's scroll before
  // the transition captures it. A page change that moves (push, pop, cover, uncover) keeps the
  // page left on screen, where it was, until the next one is ready; a tab switch, which changes in
  // place, and the first load, with nothing to keep, still show the mark. Read on every load.
  router.subscribe("onBeforeLoad", ({ fromLocation, toLocation }) => {
    router.options.defaultPendingMs =
      fromLocation && navKind(fromLocation.pathname, toLocation.pathname, false)
        ? Infinity
        : PENDING_MS;
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
