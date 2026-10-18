import type { LAUNCH_BACKGROUND } from "./src/lib/theme";

// The iPhones that run current iOS, portrait only. iOS shows a launch image only when its media
// query matches the device exactly, so an unlisted phone gets a plain screen before the HTML
// launch screen. Ceiling: iPads and landscape are left out; adding one is a row here and a rerun
// of scripts/gen-startup-images.ts.
// `top` is the status bar height in standalone mode: the page starts below it, so the HTML launch
// screen centres in the remaining height and the image has to do the same.
export type Screen = { width: number; height: number; ratio: 2 | 3; top: number }; // CSS px, portrait

// ponytail: `top` comes from Apple's status bar heights; only 390x844 is checked against a
// recording, 420x912 is a guess, and 375x812 takes the X/11 Pro value (44) although the 12 and 13
// mini it also serves use 50. A wrong value shifts the mark at the handover by the difference;
// measure the phone's recording and fix its row.
export const SCREENS: readonly Screen[] = [
  { width: 375, height: 667, ratio: 2, top: 20 },
  { width: 375, height: 812, ratio: 3, top: 44 },
  { width: 414, height: 896, ratio: 2, top: 48 },
  { width: 414, height: 896, ratio: 3, top: 44 },
  { width: 390, height: 844, ratio: 3, top: 47 },
  { width: 428, height: 926, ratio: 3, top: 47 },
  { width: 393, height: 852, ratio: 3, top: 59 },
  { width: 430, height: 932, ratio: 3, top: 59 },
  { width: 402, height: 874, ratio: 3, top: 62 },
  { width: 440, height: 956, ratio: 3, top: 62 },
  { width: 420, height: 912, ratio: 3, top: 62 },
];

type Scheme = keyof typeof LAUNCH_BACKGROUND;

export const startupFile = (theme: Scheme, s: Screen) =>
  `startup/${theme}-${s.width * s.ratio}x${s.height * s.ratio}.png`;

export const startupMedia = (theme: Scheme, s: Screen) =>
  `(device-width: ${s.width}px) and (device-height: ${s.height}px) and ` +
  `(-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: portrait) and ` +
  `(prefers-color-scheme: ${theme})`;
