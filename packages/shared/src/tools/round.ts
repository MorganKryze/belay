// Number of decimals in a step written in base 10: 2.5 → 1, 0.05 → 2, 10 → 0.
export function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

// Nearest multiple of `step`, without binary noise (0.1 + 0.2 → 0.3, not 0.30000000000000004).
export function roundTo(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(decimalsOf(step)));
}
