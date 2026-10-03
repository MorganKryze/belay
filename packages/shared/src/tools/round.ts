// Number of decimals in a step written in base 10: 2.5 → 1, 0.05 → 2, 10 → 0.
export function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

// Nearest multiple of `step`, without binary noise (0.1 + 0.2 → 0.3, not 0.30000000000000004).
// Scales by a power of ten instead of dividing by the step: 24.95 / 0.1 is 249.4999…, while
// 24.95 × 10 is exactly 249.5, so x.x5 ties round up as printed.
export function roundTo(value: number, step: number): number {
  const decimals = decimalsOf(step);
  const scale = 10 ** decimals;
  const scaledStep = Math.round(step * scale);
  return Number(
    ((Math.round((value * scale) / scaledStep) * scaledStep) / scale).toFixed(decimals),
  );
}
