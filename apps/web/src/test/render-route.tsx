import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { createAppRouter } from "../router";

// The real route tree on an in-memory history, with the app's not-found and error screens.
// `strict` renders under StrictMode, which runs every effect twice as the app does in development.
export function renderRoute(path: string, { strict = false } = {}) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return router;
}
