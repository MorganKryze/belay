import type { NavKind } from "./transitions";

// Chromium holds back :active under a finger until it knows the touch is not a scroll, so a held
// row showed its tint only on the lift. The pressed control is marked as the pointer lands instead;
// a touch that turns into a scroll is cancelled, which clears the mark.
//
// A row link released on itself keeps its mark until its navigation resolves, so the page leaving
// still shows which row opened the next one; 600 ms caps it if no navigation follows. Its href is
// kept so that, on the way back, the same row can clear its tint where the person left it.
let pressed: Element | null = null;
let hold: ReturnType<typeof setTimeout> | undefined;
let leftFrom: string | null = null;

function release() {
  clearTimeout(hold);
  hold = undefined;
  pressed?.removeAttribute("data-pressed");
  pressed = null;
}

export function markPresses(): void {
  addEventListener("pointerdown", (event) => {
    release();
    pressed = (event.target as Element).closest(".press,.press-tint,.press-icon");
    pressed?.setAttribute("data-pressed", "");
  });
  addEventListener("pointerup", (event) => {
    if (pressed?.matches("a.press-tint[href]") && pressed.contains(event.target as Node)) {
      leftFrom = pressed.getAttribute("href");
      hold = setTimeout(release, 600);
    } else release();
  });
  addEventListener("pointercancel", release);
}

// Called once a navigation resolves. After a push the href waits for the way back; after Back the
// row it names tints for a frame and clears over --untint-duration. A row not rendered within
// 300 ms plays nothing.
export function settlePresses(kind: NavKind | false): void {
  if (hold !== undefined) release();
  if (kind === "push") return;
  const href = leftFrom;
  leftFrom = null;
  if (kind !== "pop" || href === null) return;
  let looking = true;
  const giveUp = setTimeout(() => (looking = false), 300);
  const look = () => {
    const row = [...document.querySelectorAll("a.press-tint")].find(
      (a) => a.getAttribute("href") === href,
    );
    if (!row) {
      if (looking) requestAnimationFrame(look);
      return;
    }
    clearTimeout(giveUp);
    row.setAttribute("data-pressed", "");
    row.setAttribute("data-untint", "");
    // The tint has been drawn for one frame; dropping the mark now lets it fade.
    requestAnimationFrame(() => {
      row.removeAttribute("data-pressed");
      const done = (event?: Event) => {
        if (event && event.target !== row) return;
        clearTimeout(fallback);
        row.removeEventListener("transitionend", done);
        row.removeAttribute("data-untint");
      };
      // With reduced motion the tint clears at once and no transition ends.
      const fallback = setTimeout(done, 300);
      row.addEventListener("transitionend", done);
    });
  };
  requestAnimationFrame(look);
}
