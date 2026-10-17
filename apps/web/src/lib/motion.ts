// Whether a closing element will play an exit animation that ends with `animationend`. A hidden
// tab runs no animations and an element without one never fires the event, so the caller closes
// at once instead of waiting. An object, so tests can stand in for the browser's answer.
export const motion = {
  exitWillAnimate(el: Element | null): boolean {
    if (document.hidden || !el) return false;
    const name = getComputedStyle(el).animationName;
    return name !== "" && name !== "none";
  },
};
