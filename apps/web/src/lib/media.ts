import { useEffect, useReducer, useState } from "react";
import { MEDIA_CACHE, readMedia } from "./media-flag";
import { useOnline } from "./online";

// Loaded lazily, with the screens that show a loop; never from a startup module.

export const loopPath = (exerciseId: string): string | null => {
  const m = /^ds:(\d{4})$/.exec(exerciseId);
  return m ? `/media/exercises/${m[1]}` : null;
};

// Paths that failed to load during this visit: not offered again until the next one.
const failedPaths = new Set<string>();

export function useLoop(exerciseId: string): { src: string | null; failed: () => void } {
  const online = useOnline();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const path = readMedia() === "on" ? loopPath(exerciseId) : null;
  const usable = path !== null && !failedPaths.has(path);
  // Offline, only a loop already in the cache can play.
  const [cached, setCached] = useState<string | null>(null);
  useEffect(() => {
    if (online || !usable) return;
    let live = true;
    caches
      .open(MEDIA_CACHE)
      .then((cache) => cache.match(path))
      .then((hit) => live && setCached(hit ? path : null))
      .catch(() => live && setCached(null));
    return () => {
      live = false;
    };
  }, [online, usable, path]);
  const src = usable && (online || cached === path) ? path : null;
  const failed = () => {
    if (path === null) return;
    failedPaths.add(path);
    rerender();
  };
  return { src, failed };
}
