import type { LAUNCH_BACKGROUND } from "./src/lib/theme";

// The iPhones that run current iOS, portrait only. iOS shows a launch image only when its media
// query matches the device exactly, so an unlisted phone gets a plain screen before the HTML
// launch screen. Ceiling: iPads and landscape are left out; adding one is a row here and a rerun
// of scripts/gen-startup-images.ts.
export type Screen = { width: number; height: number; ratio: 2 | 3 }; // CSS px, portrait

export const SCREENS: readonly Screen[] = [
  { width: 375, height: 667, ratio: 2 },
  { width: 375, height: 812, ratio: 3 },
  { width: 414, height: 896, ratio: 2 },
  { width: 414, height: 896, ratio: 3 },
  { width: 390, height: 844, ratio: 3 },
  { width: 428, height: 926, ratio: 3 },
  { width: 393, height: 852, ratio: 3 },
  { width: 430, height: 932, ratio: 3 },
  { width: 402, height: 874, ratio: 3 },
  { width: 440, height: 956, ratio: 3 },
  { width: 420, height: 912, ratio: 3 },
];

type Scheme = keyof typeof LAUNCH_BACKGROUND;

export const startupFile = (theme: Scheme, s: Screen) =>
  `startup/${theme}-${s.width * s.ratio}x${s.height * s.ratio}.png`;

export const startupMedia = (theme: Scheme, s: Screen) =>
  `(device-width: ${s.width}px) and (device-height: ${s.height}px) and ` +
  `(-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: portrait) and ` +
  `(prefers-color-scheme: ${theme})`;
