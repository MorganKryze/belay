import { useCallback, useEffect, useState } from "react";

// Keeps the last value on screen while it leaves, so its exit animation has something to draw.
// The timer drops it when no animation ends (reduced motion, a hidden tab).
export function usePresence<T>(value: T | null, exitMs = 400) {
  const [shown, setShown] = useState<T | null>(value);
  const [leaving, setLeaving] = useState(false);
  if (value !== null && (value !== shown || leaving)) {
    setShown(value);
    setLeaving(false);
  } else if (value === null && shown !== null && !leaving) {
    setLeaving(true);
  }
  const drop = useCallback(() => {
    setShown(null);
    setLeaving(false);
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(drop, exitMs);
    return () => clearTimeout(timer);
  }, [leaving, exitMs, drop]);
  const onAnimationEnd = useCallback(() => {
    if (leaving) drop();
  }, [leaving, drop]);
  return { shown, leaving, onAnimationEnd };
}
