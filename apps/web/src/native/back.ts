import { tabIndexOf } from "@/lib/tab-index";
import { levelOf } from "@/lib/transitions";

// What Android's Back meets first, from the top: an open sheet, menu or list; the session cover;
// a pushed page; a tab's root; Accueil's root, where only the app itself can step aside.
export type Top = "surface" | "cover" | "page" | "tab-root" | "home";

// What the page needs of the router, so a test can hand it a fake one.
export interface BackRouter {
  state: { location: { pathname: string; search: unknown } };
  history: { canGoBack(): boolean; back(): void };
  navigate(options: { to: string; replace: true }): unknown;
}

declare global {
  interface Window {
    // Called by the Android app on each Back press; the answer tells it whether to step aside.
    belayBack?: () => Top;
  }
}

const ROOTS = ["/", "/workouts", "/body", "/tools"] as const;

// Radix marks each layer it shows with its state; a list or menu drawn inside a page has none.
const ROLES = ":is([role=dialog],[role=alertdialog],[role=menu],[role=listbox])";
const SURFACE = `${ROLES}[data-state]`;
const OPEN = `${ROLES}[data-state=open]`;

export function topOfStack(pathname: string): Top {
  if (document.querySelector(SURFACE)) return "surface";
  const level = levelOf(pathname);
  if (level === "cover") return "cover";
  if (level > 0) return "page";
  return pathname === "/" ? "home" : "tab-root";
}

// Takes one step and says which. Every surface closes by Escape, the path its own close button
// and focus return already take, and Radix closes only the top layer. A sheet still leaving with
// nothing open under it swallows the press: the page under it is not yet on top.
export function stepBack(router: BackRouter): Top {
  const { pathname, search } = router.state.location;
  let top = topOfStack(pathname);
  if (top === "surface") {
    if (document.querySelector(OPEN))
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return top;
  }
  if (top === "cover") {
    // The session's own control knows where lowering leads; the editor and the summary have
    // none and go back as any page does.
    const lower = document.querySelector<HTMLElement>("[data-cover-lower]");
    if (lower) {
      lower.click();
      return top;
    }
    top = "page";
  }
  if (top === "page") {
    if (router.history.canGoBack()) router.history.back();
    else {
      const tab = tabIndexOf(pathname, search as { from?: unknown } | undefined);
      void router.navigate({ to: ROOTS[tab ?? 0], replace: true });
    }
    return top;
  }
  if (top === "tab-root") void router.navigate({ to: "/", replace: true });
  return top;
}

export function installBack(router: BackRouter): void {
  window.belayBack = () => stepBack(router);
}
