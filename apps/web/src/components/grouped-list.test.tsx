import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Settings } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { expectTokensOnly } from "@/test/design-rules";
import {
  EmptyState,
  groupCard,
  GroupedList,
  RowButton,
  RowLink,
  RowText,
  sectionLabel,
  SkeletonRows,
} from "./grouped-list";

afterEach(cleanup);

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

describe("EmptyState, quiet", () => {
  it("reads a regular sentence over a smaller muted line", () => {
    render(<EmptyState sentence="Soon." precision="It fills by itself." action={null} quiet />);
    expect(classes(screen.getByText("Soon."))).not.toContain("font-semibold");
    expect(classes(screen.getByText("It fills by itself."))).toEqual(
      expect.arrayContaining(["text-(length:--text-secondary)", "text-muted-foreground"]),
    );
  });
});

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

  it("a very long value wraps instead of overflowing", () => {
    render(<RowButton label="Language" value={"Unbreakablewordwithoutanyspace".repeat(4)} />);
    const value = screen.getByText(/Unbreakableword/);
    expect(classes(value)).toEqual(expect.arrayContaining(["min-w-0", "break-words"]));
    expect(classes(screen.getByText("Language"))).toContain("basis-auto");
  });

  it("an empty list shows a sentence, a precision and one action, no image, left-aligned", () => {
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
    const box = container.firstElementChild;
    expect(classes(box)).toEqual(expect.arrayContaining(["items-start", "text-left", "p-4"]));
    expect(classes(box)).not.toContain("items-center");
    expect(classes(box)).not.toContain("text-center");
  });

  it("skeleton rows stand still with two grey lines", () => {
    const { container } = render(<SkeletonRows count={3} />);
    const rows = container.querySelectorAll("[data-slot=skeleton-row]");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.querySelectorAll(".h-3.bg-track")).toHaveLength(2);
    }
    expect(container.innerHTML).not.toMatch(/animate-/);
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
  });

  it("skeleton rows start with a 28 px square", () => {
    const { container } = render(<SkeletonRows count={2} />);
    for (const row of container.querySelectorAll("[data-slot=skeleton-row]")) {
      expect(classes(row.firstElementChild)).toEqual(
        expect.arrayContaining(["size-7", "shrink-0", "rounded-icon", "bg-track"]),
      );
    }
  });

  it("the group card and section label are the shared classes", () => {
    render(
      <GroupedList label="Display">
        <RowButton label="A" />
      </GroupedList>,
    );
    expect(
      classes(within(screen.getByRole("region", { name: "Display" })).getByRole("list")),
    ).toEqual(expect.arrayContaining(groupCard.split(" ")));
    expect(classes(screen.getByRole("heading", { name: "Display" }))).toEqual(
      expect.arrayContaining(sectionLabel.split(" ")),
    );
  });

  it("a prominent row is 72 px with its own leading picture and a second line", () => {
    render(
      <RowButton
        prominent
        icon={Settings}
        leading={
          <span aria-hidden="true" data-testid="avatar">
            A
          </span>
        }
        label="Ada"
        sub="Profile · height, age, loss range"
        trailing="push"
      />,
    );
    const row = screen.getByRole("button", { name: "Ada Profile · height, age, loss range" });
    expect(classes(row)).toContain("min-h-18");
    expect(row.querySelector("[data-testid=avatar]")).toBeTruthy();
    // The leading picture takes the icon square's place.
    expect(row.querySelector("[data-slot=row-icon]")).toBeNull();
    expect(classes(screen.getByText("Ada"))).toEqual(
      expect.arrayContaining(["text-title-compact"]),
    );
    expect(classes(screen.getByText("Profile · height, age, loss range"))).toEqual(
      expect.arrayContaining(["truncate", "text-muted-foreground"]),
    );
    expect(row.querySelector("[data-slot=row-chevron]")).toBeTruthy();
  });

  it("a destructive row is red text alone, centred", () => {
    render(<RowButton label="Sign out" destructive trailing="push" icon={Settings} />);
    const row = screen.getByRole("button", { name: "Sign out" });
    expect(classes(screen.getByText("Sign out"))).toEqual(
      expect.arrayContaining(["text-destructive", "text-center"]),
    );
    expect(classes(row)).toContain("justify-center");
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

  it("names the group once, on its section, not again on the list", () => {
    render(
      <GroupedList label="Display">
        <RowButton label="A" />
      </GroupedList>,
    );
    const list = within(screen.getByRole("region", { name: "Display" })).getByRole("list");
    expect(list.hasAttribute("aria-labelledby")).toBe(false);
    expect(screen.queryByRole("list", { name: "Display" })).toBeNull();
  });

  it("labels the group and draws it as one card with hairlines", () => {
    render(
      <GroupedList label="Display">
        <RowButton label="A" />
        <RowButton label="B" />
      </GroupedList>,
    );
    const list = within(screen.getByRole("region", { name: "Display" })).getByRole("list");
    expect(classes(list)).toEqual(
      expect.arrayContaining(["bg-surface", "rounded-group", "shadow-card", "divide-y"]),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(classes(screen.getByText("Display"))).toEqual(
      expect.arrayContaining(["text-section", "text-muted-foreground"]),
    );
  });

  it("a text row wraps its label and detail, never cuts them, and takes no focus", () => {
    render(
      <GroupedList label="Refused">
        <RowText label={"Long label ".repeat(10)} detail={"Long detail ".repeat(10)} />
      </GroupedList>,
    );
    const label = screen.getByText(/Long label/);
    const detail = screen.getByText(/Long detail/);
    expect(classes(label)).toEqual(
      expect.arrayContaining(["text-body", "font-semibold", "break-words"]),
    );
    expect(classes(detail)).toEqual(
      expect.arrayContaining(["text-muted-foreground", "break-words"]),
    );
    expect(classes(label)).not.toContain("truncate");
    expect(classes(detail)).not.toContain("truncate");
    const row = label.parentElement!;
    expect(classes(row)).toEqual(expect.arrayContaining(["min-h-14", "px-4", "py-2"]));
    expect(classes(row)).not.toContain("press-tint");
    expect(row.tagName).toBe("DIV");
    expect(row.hasAttribute("tabindex")).toBe(false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a footer sits under the card and describes the list", () => {
    render(
      <GroupedList label="Refused" footer="They are no longer waiting.">
        <RowText label="Weigh-in" />
      </GroupedList>,
    );
    const list = within(screen.getByRole("region", { name: "Refused" })).getByRole("list");
    expect(list.getAttribute("aria-describedby")).toBeTruthy();
    const footer = screen.getByText("They are no longer waiting.");
    expect(footer.id).toBe(list.getAttribute("aria-describedby"));
    expect(list.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(classes(footer)).toEqual(expect.arrayContaining(["px-4", "text-muted-foreground"]));
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
