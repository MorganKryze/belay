// The fine cracks drawn in the wall's top-right corner, one SVG per theme. Run by hand after a
// change to the drawing: `node apps/web/scripts/gen-cracks.mjs` writes src/assets/cracks-*.svg.
// A seeded walk, so the same numbers always give the same drawing.
import { writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const W = 240;
const H = 560;
// The extra crack's steps at density 2.
const LENGTH = 100;
// Every crack stays in the right 60 % of the corner: the left of it lies under titles and text.
// The drawing starts at the top, beside the titles at the default text size; larger text widens
// them across it, and cracks.css then moves the drawing down, 150 px at twice the size. A crack
// that runs off the bottom ends there.
const LEFT = W * 0.4;
const INK = { light: "#12181c", dark: "#eef2f3" };
// The Belay mark on its 100-unit grid, as src/lib/mark.ts holds it (the tests hold the two
// equal): a ring of radius 37 and a mountain, stroked 11 wide.
const RING = "M28.6 78.8 A37 37 0 1 1 71.4 78.8";
const MOUNTAIN = "M28.6 78.8 L39 58 L45 64 L56 44 L71.4 78.8";
const STROKE = 11;
// The corner of the mark's ink on the grid, before its one-unit shift down: the ring's circle
// (centre 50, 48.6) less its radius and half the stroke.
const INK_X = 50 - 37 - STROKE / 2;
const INK_Y = 78.8 - Math.sqrt(37 ** 2 - 21.4 ** 2) - 37 - STROKE / 2;
const INK_WIDTH = 2 * 37 + STROKE;

const r1 = (n) => Math.round(n * 10) / 10;
const pts = (p) => p.map(([x, y]) => `${r1(x)} ${r1(y)}`).join("L");

/**
 * The cracks for one theme. Density 1 is the first drawing; above it, one more crack comes in off
 * the right edge, branching more often than the others, longer as density grows. It is walked
 * last, so the first drawing's cracks stay as they were.
 * @param {"light" | "dark"} theme
 * @param {number} density
 * @returns {string}
 */
export function fissures(theme, density) {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const paths = [];
  // A jagged walk drawn in three segments, each thinner than the one before.
  const crack = (x, y, ang, len, step, w0, depth, branch = 0.07) => {
    const p = [[x, y]];
    const heading = ang;
    for (let i = 0; i < len; i++) {
      ang = heading + (ang - heading) * 0.7 + (rnd() - 0.5) * 1.3;
      x += Math.cos(ang) * step * (0.6 + rnd() * 0.8);
      y += Math.sin(ang) * step * (0.6 + rnd() * 0.8);
      if (x < LEFT || y > H) break;
      p.push([x, y]);
      if (depth > 0 && i > 4 && rnd() < branch) {
        const turn = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5);
        crack(
          x,
          y,
          ang + turn,
          6 + Math.floor(rnd() * 10),
          step * 0.85,
          w0 * 0.6,
          depth - 1,
          branch,
        );
      }
    }
    const thirds = [0, Math.floor(p.length / 3), Math.floor((2 * p.length) / 3), p.length - 1];
    for (let k = 0; k < 3; k++) {
      const seg = p.slice(thirds[k], thirds[k + 1] + 1);
      const width = Math.round(w0 * (1 - k * 0.3) * 100) / 100;
      if (seg.length > 1) paths.push(`<path d="M${pts(seg)}" stroke-width="${width}"/>`);
    }
    return p;
  };
  // The main crack comes in at the top edge and bends down along the right edge.
  const main = crack(175, -2, 1.68, 64, 6, 1.0, 2);
  crack(W + 2, 120, 2.75, 20, 5, 0.75, 1);
  crack(W + 2, 380, 2.5, 14, 5, 0.6, 0);
  if (density > 1) crack(W + 2, 250, 2.65, Math.round(LENGTH * (density - 1)), 5, 0.65, 1, 0.1);
  // The mark sits in the main crack, 12 px wide, its ink's corner where the old hook's was.
  const [hx, hy] = main[9];
  const at = `translate(${r1(hx - 6)} ${r1(hy - 1)}) scale(${Math.round((12 / INK_WIDTH) * 1e4) / 1e4}) translate(-${r1(INK_X)} -${r1(INK_Y)})`;
  const lines = theme === "light" ? 0.3 : 0.26;
  const mark = theme === "light" ? 0.42 : 0.36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g fill="none" stroke="${INK[theme]}" stroke-linecap="round" stroke-linejoin="round" opacity="${lines}">${paths.join("")}</g><g opacity="${mark}" fill="none" stroke="${INK[theme]}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" transform="${at}"><path d="${RING}"/><path d="${MOUNTAIN}"/></g></svg>`;
}

/**
 * The total length of the cracks in an SVG this script wrote, the mark left out.
 * @param {string} svg
 * @returns {number}
 */
export function crackLength(svg) {
  let total = 0;
  for (const [, d] of svg.matchAll(/<path d="M([^"]+)" stroke-width/g)) {
    const p = d.split("L").map((pair) => pair.split(" ").map(Number));
    for (let i = 1; i < p.length; i++)
      total += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  }
  return total;
}

// A third more crack than the first drawing, as asked once it was seen on the phone.
export const DENSITY = 1.35;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const theme of ["light", "dark"]) {
    const out = new URL(`../src/assets/cracks-${theme}.svg`, import.meta.url);
    writeFileSync(out, fissures(theme, DENSITY));
  }
}
