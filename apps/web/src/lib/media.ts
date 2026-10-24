import { useEffect, useReducer, useRef, useState } from "react";
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
  // The answer names the path it is for, so a pending check is told apart from a miss.
  const [checked, setChecked] = useState<{ path: string; hit: boolean } | null>(null);
  useEffect(() => {
    if (online || !usable) return;
    let live = true;
    caches
      .open(MEDIA_CACHE)
      .then((cache) => cache.match(path))
      .then((hit) => live && setChecked({ path, hit: hit !== undefined }))
      .catch(() => live && setChecked({ path, hit: false }));
    return () => {
      live = false;
    };
  }, [online, usable, path]);
  // Until the cache answers, the source already playing stays, so going offline does not remount it.
  const last = useRef<string | null>(null);
  const answered = checked?.path === path;
  const offlineSrc = answered ? (checked.hit ? path : null) : last.current === path ? path : null;
  const src = usable && (online || offlineSrc !== null) ? path : null;
  last.current = src;
  const failed = () => {
    if (path === null) return;
    failedPaths.add(path);
    rerender();
  };
  return { src, failed };
}
