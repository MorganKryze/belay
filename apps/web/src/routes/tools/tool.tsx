import type { ToolId } from "@belay/shared/tools/catalog";
import { useParams } from "@tanstack/react-router";
import { type ComponentType, Suspense } from "react";
import { NotFound } from "../fallbacks";

// One chunk per tool, loaded on demand and precached by the service worker. Each tool task
// adds its line; an id without a page yet shows the not-found screen.
const PAGES: Partial<Record<ToolId, ComponentType>> = {};

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
