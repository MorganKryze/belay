// The phone's text size while the app is open. theme-init.js sets --text-scale before the first
// paint, reading it as readRatio does; this keeps it current on the iPhone, where the size can
// change from Control Centre with no event to say so, and keeps room for a dock that grew with it.
// Android restarts the activity on a font scale change, so its first reading stands. The contrast
// the Android app reports is read again each time the app comes back to the foreground.

// The iPhone's body text style at the system's default size.
export const BODY_PX = 17;

// The phone's text size over its default, or null for anything but a size.
export const readRatio = (bodyPx: number): number | null =>
  Number.isFinite(bodyPx) && bodyPx > 0 ? bodyPx / BODY_PX : null;

const root = document.documentElement;
const ratio = () => Number(root.style.getPropertyValue("--text-scale") || 1);

export function watchTextScale(): void {
  if (CSS.supports("font", "-apple-system-body")) {
    // A hidden line in the system's body style: it resizes when the system's text size changes.
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.dataset.textProbe = "";
    probe.style.cssText =
      "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;font:-apple-system-body";
    probe.textContent = "A";
    document.body.append(probe);
    new ResizeObserver(() => {
      const read = readRatio(parseFloat(getComputedStyle(probe).fontSize));
      if (read === null) return;
      root.style.setProperty("--text-scale", String(read));
      followDock();
    }).observe(probe);
  }
  followDock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") readContrast();
  });
}

// The Android web view does not pass the system's increased contrast on, so the shell reports it
// (theme-init.js reads it at the first paint); a change in Settings shows when the app comes back.
function readContrast(): void {
  const shell = (globalThis as { BelayText?: { contrast?: () => boolean } }).BelayText;
  if (shell?.contrast === undefined) return;
  if (shell.contrast()) root.dataset.contrast = "more";
  else delete root.dataset.contrast;
}

// The page keeps room for the dock at its default height (layout.tsx); what larger text adds to
// it goes into --dock-extra. Nothing is watched at the default size, so nothing runs there.
// data-text-scaled marks enlarged text, so what keeps one line at the default size (the session
// bar) wraps only then, where the room follows the dock.
let watching: { size: ResizeObserver; tree: MutationObserver } | null = null;
let dock: Element | null = null;

function followDock(): void {
  root.toggleAttribute("data-text-scaled", ratio() !== 1);
  if (ratio() === 1) {
    watching?.size.disconnect();
    watching?.tree.disconnect();
    watching = null;
    dock = null;
    root.style.setProperty("--dock-extra", "0px");
    return;
  }
  if (watching === null) {
    watching = {
      size: new ResizeObserver(() => {
        if (dock) root.style.setProperty("--dock-extra", `${growth(dock)}px`);
      }),
      // The dock leaves with the tabs (the session cover, a computer's width) and comes back as a
      // new element.
      tree: new MutationObserver(findDock),
    };
    watching.tree.observe(document.body, { childList: true, subtree: true });
  }
  // A new ratio is measured again, so the dock is observed afresh.
  if (dock) watching.size.unobserve(dock);
  dock = null;
  findDock();
}

function findDock(): void {
  const found = document.querySelector("[data-dock]");
  if (found === dock || watching === null) return;
  if (dock) watching.size.unobserve(dock);
  dock = found;
  if (dock) watching.size.observe(dock);
  else root.style.setProperty("--dock-extra", "0px");
}

// How much taller the dock is than at the default text size, its lines unwrapped as there: measured
// both ways in the same task, so the default size is never painted.
function growth(el: Element): number {
  const scale = root.style.getPropertyValue("--text-scale");
  const now = el.getBoundingClientRect().height;
  root.style.setProperty("--text-scale", "1");
  root.removeAttribute("data-text-scaled");
  const base = el.getBoundingClientRect().height;
  root.setAttribute("data-text-scaled", "");
  root.style.setProperty("--text-scale", scale);
  return Math.max(0, Math.round(now - base));
}
