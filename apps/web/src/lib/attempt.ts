// The tool functions throw a RangeError on out-of-spec input. Inputs are bounded by their
// fields, so this is a backstop: a page shows an empty result rather than crashing.
export function attempt<T>(compute: () => T): T | null {
  try {
    return compute();
  } catch {
    return null;
  }
}
