import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Settings } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { expectTokensOnly } from "@/test/design-rules";
import { EmptyState, GroupedList, RowButton, RowLink, SkeletonRows } from "./grouped-list";

afterEach(cleanup);

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

describe("GroupedList", () => {
  it("a row is at least 52 px with a 28 px tinted square and a 20 px icon", () => {
    render(<RowButton icon={Settings} label="Units" />);
    const row = screen.getByRole("button", { name: "Units" });
    expect(classes(row)).toContain("min-h-14");
    const square = row.querySelector("[data-slot=row-icon]");
    expect(classes(square)).toEqual(
      expect.arrayContaining(["size-7", "bg-primary-soft", "rounded-icon"]),
    );
    const icon = square!.querySelector("svg");
    expect(classes(icon)).toEqual(expect.arrayContaining(["size-5", "text-primary-ink"]));
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
  });

  it("a pushed page gets a right chevron, a menu a down chevron", () => {
    render(
      <>
        <RowButton label="Push" trailing="push" />
        <RowButton label="Menu" trailing="menu" />
        <RowButton label="None" />
      </>,
    );
    const chevron = (name: string) =>
      screen.getByRole("button", { name }).querySelector("[data-slot=row-chevron]");
    expect(classes(chevron("Push"))).toEqual(
      expect.arrayContaining(["lucide-chevron-right", "size-4"]),
    );
    expect(classes(chevron("Menu"))).toEqual(
      expect.arrayContaining(["lucide-chevron-down", "size-4"]),
    );
    expect(chevron("None")).toBeNull();
  });

  it("a long label ends in an ellipsis on one line", () => {
    render(<RowButton label={"Very long label ".repeat(10)} />);
    const label = screen.getByText(/Very long label/);
    expect(classes(label)).toEqual(
      expect.arrayContaining(["truncate", "text-body", "font-semibold", "min-w-0", "flex-1"]),
    );
  });

  it("a value too wide for 360 px moves to a second line", () => {
    render(<RowButton label="Theme" value="Follow the system" />);
    const row = screen.getByRole("button", { name: /Theme/ });
    const value = screen.getByText("Follow the system");
    expect(classes(value)).toContain("text-muted-foreground");
    expect(classes(value.parentElement)).toContain("flex-wrap");
    expect(classes(screen.getByText("Theme"))).toContain("min-w-0");
    expect(row.textContent).toContain("Follow the system");
  });

  it("an empty list shows a sentence, a precision and one action, no image", () => {
    const { container } = render(
      <EmptyState
        sentence="Nothing yet."
        precision="Your weigh-ins show here."
        action={<button type="button">Add</button>}
      />,
    );
    expect(screen.getByText("Nothing yet.")).toBeTruthy();
    expect(classes(screen.getByText("Your weigh-ins show here."))).toContain(
      "text-muted-foreground",
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(container.querySelector("img, svg")).toBeNull();
  });

  it("skeleton rows stand still with two grey lines", () => {
    const { container } = render(<SkeletonRows count={3} />);
    const rows = container.querySelectorAll("[data-slot=skeleton-row]");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.querySelectorAll(".bg-track")).toHaveLength(2);
    }
    expect(container.innerHTML).not.toMatch(/animate-/);
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
  });

  it("a destructive row is red text alone", () => {
    render(<RowButton label="Sign out" destructive trailing="push" icon={Settings} />);
    const row = screen.getByRole("button", { name: "Sign out" });
    expect(classes(screen.getByText("Sign out"))).toContain("text-destructive");
    expect(row.querySelector("[data-slot=row-icon]")).toBeNull();
    expect(row.querySelector("[data-slot=row-chevron]")).toBeNull();
    expect(row.className).not.toMatch(/bg-destructive/);
  });

  it("rows tint 6 % on press and never scale", () => {
    render(<RowButton label="Units" />);
    const row = screen.getByRole("button", { name: "Units" });
    expect(classes(row)).toContain("press-tint");
    expect(row.className).not.toMatch(/press-scale|scale-/);
  });

  it("labels the group and draws it as one card with hairlines", () => {
    render(
      <GroupedList label="Display">
        <RowButton label="A" />
        <RowButton label="B" />
      </GroupedList>,
    );
    const list = screen.getByRole("list", { name: "Display" });
    expect(classes(list)).toEqual(
      expect.arrayContaining(["bg-surface", "rounded-group", "shadow-card", "divide-y"]),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(classes(screen.getByText("Display"))).toEqual(
      expect.arrayContaining(["text-section", "text-muted-foreground"]),
    );
  });

  it("RowLink navigates", async () => {
    const root = createRootRoute({ component: Outlet });
    const home = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => (
        <GroupedList>
          <RowLink to="/settings" label="Units" trailing="push" />
        </GroupedList>
      ),
    });
    const settings = createRoute({
      getParentRoute: () => root,
      path: "/settings",
      component: () => <p>Units page</p>,
    });
    const router = createRouter({
      routeTree: root.addChildren([home, settings]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    const link = await screen.findByRole("link", { name: "Units" });
    expect(classes(link)).toContain("min-h-14");
    await act(async () => {
      fireEvent.click(link);
    });
    expect(await screen.findByText("Units page")).toBeTruthy();
  });

  it("uses tokens only", () => {
    expectTokensOnly("components/grouped-list.tsx");
  });
});
