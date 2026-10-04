import { existsSync, readFileSync } from "node:fs";

// Every script that dist/index.html loads or preloads, so a chunk the bundler hoists out of the
// entry (runtime, i18n, router) stays inside the gauge. Run `pnpm build` first.
const dist = "apps/web/dist";
const html = existsSync(`${dist}/index.html`) ? readFileSync(`${dist}/index.html`, "utf8") : "";
const path = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map(
  (m) => `${dist}/${m[1]}`,
);

export default [
  {
    name: "web: initial JavaScript (gzip)",
    path: path.length > 0 ? path : [`${dist}/assets/index-*.js`],
    gzip: true,
    limit: "157 KiB",
  },
];
