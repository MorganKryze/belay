// Chromium holds back :active under a finger until it knows the touch is not a scroll, so a held
// row showed its tint only on the lift. The pressed control is marked as the pointer lands instead;
// a touch that turns into a scroll is cancelled, which clears the mark.
export function markPresses() {
  let pressed: Element | null = null;
  const release = () => pressed?.removeAttribute("data-pressed");
  addEventListener("pointerdown", (event) => {
    release();
    pressed = (event.target as Element).closest(".press,.press-tint");
    pressed?.setAttribute("data-pressed", "");
  });
  addEventListener("pointerup", release);
  addEventListener("pointercancel", release);
}
