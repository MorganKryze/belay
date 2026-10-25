import { useEffect, useReducer, useRef, useState } from "react";
import { MEDIA_CACHE, readMedia } from "./media-flag";
import { useOnline } from "./online";
import { apiFetch, isNative, readInstance } from "./platform";

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
  const native = isNative();
  const kept = useKeptLoop(native && usable ? path : null, online, rerender);
  // Offline, only a loop already in the cache can play.
  // The answer names the path it is for, so a pending check is told apart from a miss.
  const [checked, setChecked] = useState<{ path: string; hit: boolean } | null>(null);
  useEffect(() => {
    if (native || online || !usable) return;
    let live = true;
    caches
      .open(MEDIA_CACHE)
      .then((cache) => cache.match(path))
      .then((hit) => live && setChecked({ path, hit: hit !== undefined }))
      .catch(() => live && setChecked({ path, hit: false }));
    return () => {
      live = false;
    };
  }, [native, online, usable, path]);
  // Until the cache answers, the source already playing stays, so going offline does not remount it.
  const last = useRef<string | null>(null);
  const answered = checked?.path === path;
  const offlineSrc = answered ? (checked.hit ? path : null) : last.current === path ? path : null;
  const src = native ? kept : usable && (online || offlineSrc !== null) ? path : null;
  last.current = src;
  const failed = () => {
    if (path === null) return;
    failedPaths.add(path);
    rerender();
  };
  return { src, failed };
}

// In the iPhone app the page comes from the app, and the server lets only its own pages load its
// media: the loop is fetched with the token and shown from an object URL. Each one is kept under
// its full instance address (Cache Storage takes only http keys), so it plays offline after one
// view. Kept loops are capped by count, the oldest first out; a size budget would need each
// entry's bytes, which Cache Storage does not give.
const KEPT_LOOPS = 150;

async function keptOrFetched(path: string, online: boolean): Promise<Blob | null> {
  // The address apiUrl gives on the phone, spelled out here: importing apiUrl into this lazy
  // module would cost the startup bundle one more export.
  const key = `${readInstance() ?? ""}${path}`;
  // Without Cache Storage, or where it refuses, a loop still plays: it is just not kept.
  const cache =
    typeof caches === "undefined" ? null : await caches.open(MEDIA_CACHE).catch(() => null);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit.blob();
  if (!online) return null;
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  const blob = await res.blob();
  if (cache) {
    const type = res.headers.get("Content-Type") ?? "video/mp4";
    void (async () => {
      await cache.put(key, new Response(blob, { headers: { "Content-Type": type } }));
      // Keys come back in the order they were put.
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, -KEPT_LOOPS).map((k) => cache.delete(k)));
    })().catch(() => {
      // Keeping is a bonus: the loop plays all the same, and is fetched again next time.
    });
  }
  return blob;
}

function useKeptLoop(path: string | null, online: boolean, rerender: () => void): string | null {
  const [shown, setShown] = useState<{ path: string; url: string } | null>(null);
  const showing = shown?.path === path;
  useEffect(() => {
    // A loop already shown stays when the connection changes.
    if (path === null || showing) return;
    let live = true;
    keptOrFetched(path, online)
      .then((blob) => {
        if (live && blob) setShown({ path, url: URL.createObjectURL(blob) });
      })
      .catch(() => {
        if (!live) return;
        failedPaths.add(path);
        rerender();
      });
    return () => {
      live = false;
    };
  }, [path, online, showing, rerender]);
  // Each object URL is let go once replaced, and when the loop leaves the screen.
  useEffect(() => (shown ? () => URL.revokeObjectURL(shown.url) : undefined), [shown]);
  return showing ? shown.url : null;
}
