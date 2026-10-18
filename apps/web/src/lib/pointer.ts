// Menus, sheets and dialogs give the focus back to the control that opened them as they close.
// Safari counts that focus as visible even after a tap, so a ring showed on a row the person had
// only touched. The page is marked while the last input is a pointer and the stylesheet hides the
// ring then; the first key press clears the mark and every ring is back. Capture phase, so a
// control that stops the event still counts.
export function markPointer(): void {
  const root = document.documentElement;
  addEventListener("pointerdown", () => root.setAttribute("data-pointer", ""), true);
  addEventListener("keydown", () => root.removeAttribute("data-pointer"), true);
}
