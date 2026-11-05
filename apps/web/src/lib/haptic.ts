// The hand's answer to a deliberate action: a logged set, a step, a switch. The phone apps set the
// engine once they start (native/session.ts); in a browser there is none, and nothing happens: the
// web has no haptic worth reaching for. Called beside a write, never in its path, and never awaited.
export type Haptic = "success" | "selection" | "light";

let fire: ((kind: Haptic) => void) | null = null;

export const setHaptics = (engine: (kind: Haptic) => void): void => {
  fire = engine;
};

export const haptic = (kind: Haptic): void => {
  fire?.(kind);
};
