import type { ToolId } from "@belay/shared/tools/catalog";
import { useParams } from "@tanstack/react-router";
import { type ComponentType, lazy, Suspense } from "react";
import { NotFound } from "../fallbacks";

// One chunk per tool, loaded on demand and precached by the service worker. Each tool task
// adds its line; an id without a page yet shows the not-found screen.
const PAGES: Partial<Record<ToolId, ComponentType>> = {
  energy: lazy(() => import("./energy").then((m) => ({ default: m.EnergyTool }))),
  protein: lazy(() => import("./protein").then((m) => ({ default: m.ProteinTool }))),
  projection: lazy(() => import("./projection").then((m) => ({ default: m.ProjectionTool }))),
  "one-rep-max": lazy(() => import("./one-rep-max").then((m) => ({ default: m.OneRepMaxTool }))),
  plates: lazy(() => import("./plates").then((m) => ({ default: m.PlatesTool }))),
  bmi: lazy(() => import("./bmi").then((m) => ({ default: m.BmiTool }))),
  "body-fat": lazy(() => import("./body-fat").then((m) => ({ default: m.BodyFatTool }))),
  warmup: lazy(() => import("./warmup").then((m) => ({ default: m.WarmupTool }))),
};

export function Tool() {
  // The route's beforeLoad already turned an unknown id into the not-found screen.
  const { toolId } = useParams({ from: "/tools/$toolId" });
  const Page = PAGES[toolId as ToolId];
  if (!Page) return <NotFound />;
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
