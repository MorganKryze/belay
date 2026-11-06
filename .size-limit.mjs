import { existsSync, readFileSync } from "node:fs";

// Every script that dist/index.html loads or preloads (the hoisted chunks, theme-init.js and
// registerSW.js included), so nothing the page runs at startup escapes the gauge. Run
// `pnpm build` first.
const dist = "apps/web/dist";
const html = existsSync(`${dist}/index.html`) ? readFileSync(`${dist}/index.html`, "utf8") : "";
const path = [...html.matchAll(/(?:src|href)="\/([^"]+\.js)"/g)].map((m) => `${dist}/${m[1]}`);

export default [
  {
    name: "web: initial JavaScript (gzip)",
    path: path.length > 0 ? path : [`${dist}/assets/index-*.js`],
    gzip: true,
    // 180 KiB: the redesign filled 170 KiB, then units and the stored program filled 176 KiB.
    // Screens stay lazy-loaded, so this covers the startup shell only.
    limit: "180 KiB",
  },
  {
    // The bundled display face and the two crack drawings, in bytes: woff2 is already compressed,
    // and each drawing has its own 6 kB ceiling in cracks.test.ts.
    name: "display face and cracks (bytes)",
    path: [`${dist}/assets/archivo-belay-*.woff2`, `${dist}/assets/cracks-*.svg`],
    gzip: false,
    brotli: false,
    limit: "23.3 kB",
  },
];
