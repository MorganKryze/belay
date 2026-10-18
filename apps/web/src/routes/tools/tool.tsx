import type { ToolId } from "@belay/shared/tools/catalog";
import { type AsyncRouteComponent, lazyRouteComponent, useParams } from "@tanstack/react-router";
import { Suspense } from "react";

// One chunk per tool, loaded on demand and precached by the service worker. The Record makes
// the compiler demand a page for every id in the catalog.
const PAGES: Record<ToolId, AsyncRouteComponent<object>> = {
  energy: lazyRouteComponent(() => import("./energy"), "EnergyTool"),
  protein: lazyRouteComponent(() => import("./protein"), "ProteinTool"),
  projection: lazyRouteComponent(() => import("./projection"), "ProjectionTool"),
  "one-rep-max": lazyRouteComponent(() => import("./one-rep-max"), "OneRepMaxTool"),
  plates: lazyRouteComponent(() => import("./plates"), "PlatesTool"),
  bmi: lazyRouteComponent(() => import("./bmi"), "BmiTool"),
  "body-fat": lazyRouteComponent(() => import("./body-fat"), "BodyFatTool"),
  warmup: lazyRouteComponent(() => import("./warmup"), "WarmupTool"),
};

// The route's loader: a pushed tool slides in with its page drawn, not blank while it loads.
export const loadToolPage = (id: ToolId) => PAGES[id].preload?.();

export function Tool() {
  // The route's beforeLoad already turned an unknown id into the not-found screen.
  const { toolId } = useParams({ from: "/tools/$toolId" });
  const Page = PAGES[toolId as ToolId];
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
