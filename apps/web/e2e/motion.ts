import type { Page } from "@playwright/test";

export type Motion = {
  target: string;
  duration: number;
  easing: string;
  transforms: boolean;
  kind: "animation" | "transition";
};

// Every animation and transition the page runs, each stored once, read on every frame so a
// short one cannot slip between two reads. Kept on window: a full navigation starts a new list.
export async function recordMotion(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { motion: Motion[] };
    w.motion = [];
    const seen = new WeakSet<Animation>();
    const describe = (el: Element | null, pseudo: string | null) => {
      if (pseudo) return pseudo;
      if (!el) return "";
      const data = el
        .getAttributeNames()
        .filter((n) => n.startsWith("data-") || n === "role")
        .map((n) => (n === "role" ? `[role=${el.getAttribute(n)}]` : `[${n}]`));
      return el.tagName.toLowerCase() + data.join("");
    };
    const moves = (k: Keyframe) =>
      ["transform", "translate", "scale", "rotate"].some((p) => {
        const v = k[p];
        return v != null && v !== "" && v !== "none";
      });
    const tick = () => {
      for (const a of document.getAnimations()) {
        if (seen.has(a)) continue;
        seen.add(a);
        const effect = a.effect as KeyframeEffect | null;
        if (!effect) continue;
        const keyframes = effect.getKeyframes();
        const transition = a instanceof CSSTransition;
        w.motion.push({
          target: describe(effect.target, effect.pseudoElement),
          duration: Number(effect.getComputedTiming().duration),
          // A transition carries its curve on the timing, an animation on its keyframes.
          easing: transition ? effect.getTiming().easing! : String(keyframes[0]?.easing),
          transforms: keyframes.some(moves),
          kind: transition ? "transition" : "animation",
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export async function readMotion(page: Page): Promise<Motion[]> {
  return page.evaluate(() => (window as unknown as { motion: Motion[] }).motion);
}
