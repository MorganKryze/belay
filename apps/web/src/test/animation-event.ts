// jsdom has no AnimationEvent, so React listens for the prefixed webkitAnimationEnd and a fired
// animationend never reaches onAnimationEnd. Defined before React loads, React keeps the standard
// name and Testing Library builds a real event with its animationName.
if (!("AnimationEvent" in window)) {
  class AnimationEvent extends Event {
    readonly animationName: string;
    readonly elapsedTime: number;
    readonly pseudoElement: string;
    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? "";
      this.elapsedTime = init.elapsedTime ?? 0;
      this.pseudoElement = init.pseudoElement ?? "";
    }
  }
  Object.assign(window, { AnimationEvent });
}
