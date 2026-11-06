// An answer that never comes must not keep the launch screen up.
export const LAUNCH_SAFETY_MS = 4000;

// Calls launch once the account is known and the first page has had two frames to draw, or at the
// safety delay after start whatever happens. The launch screen holds nothing back: it covers the
// wait, it does not add to it. Returns the cleanup.
export function holdLaunch(known: boolean, launch: () => void, start: number): () => void {
  const safety = setTimeout(launch, Math.max(0, start + LAUNCH_SAFETY_MS - performance.now()));
  if (!known) return () => clearTimeout(safety);
  // The first frame lays the page out, the second paints it: the screen goes once the page is
  // there to be seen.
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      clearTimeout(safety);
      launch();
    });
  });
  return () => {
    clearTimeout(safety);
    cancelAnimationFrame(frame);
  };
}
