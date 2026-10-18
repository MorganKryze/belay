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
    // 176 KiB: the motion, preload and press code of the redesign filled the old 170 KiB; screens
    // stay lazy-loaded, so this covers the startup shell only.
    limit: "176 KiB",
  },
];
