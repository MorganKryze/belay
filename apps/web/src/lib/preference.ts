// One device preference under `key`: `initial` unless storage says `other`. Where storage refuses
// the choice (some private modes), it lives in memory for the visit. Startup-safe: no imports, so
// the startup readers and the lazy ones can share it.
export function preference<T extends string>(key: string, initial: T, other: T) {
  let fallback: T = initial;
  const read = (): T => {
    try {
      return localStorage.getItem(key) === other ? other : initial;
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
