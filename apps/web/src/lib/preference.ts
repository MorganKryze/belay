// One device preference under `key`: `initial` unless storage holds one of the `others`. Where storage refuses
// the choice (some private modes), it lives in memory for the visit. Startup-safe: no imports, so
// the startup readers and the lazy ones can share it.
export function preference<T extends string>(key: string, initial: T, ...others: T[]) {
  let fallback: T = initial;
  const read = (): T => {
    try {
      const stored = localStorage.getItem(key);
      return others.find((o) => o === stored) ?? initial;
    } catch {
      return fallback;
    }
  };
  const set = (choice: T) => {
    fallback = choice;
    try {
      localStorage.setItem(key, choice);
    } catch {
      // Storage refused: the choice holds for this visit only, through the fallback above.
    }
  };
  return [read, set] as const;
}
