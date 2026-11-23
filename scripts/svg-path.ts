// An SVG path's data as absolute moves, lines and cubic curves only, so a native renderer draws the
// same outline with three calls. Every command of the path grammar is read, relative or absolute,
// with its implicit repeats and the arc flags written without a separator ("01-.9" is 0, 1, -.9).
export type PathCommand =
  | ["M", number, number]
  | ["L", number, number]
  | ["C", number, number, number, number, number, number]
  | ["Z"];

const ARITY: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

// Two decimals: a hundredth of a unit on a 1 256-unit-tall figure is far below a pixel.
const round = (v: number) => Math.round(v * 100) / 100 + 0;

function tokens(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  let i = 0;
  // The arc's fourth and fifth arguments are flags: one digit each, whatever follows them.
  let command = "";
  let argument = 0;
  while (i < d.length) {
    const ch = d[i]!;
    if (/[\s,]/.test(ch)) {
      i++;
    } else if (/[a-zA-Z]/.test(ch)) {
      const upper = ch.toUpperCase();
      if (!(upper in ARITY)) throw new Error(`unknown path command ${ch} at ${i}`);
      out.push(ch);
      command = upper;
      argument = 0;
      i++;
    } else {
      const flag = command === "A" && (argument % 7 === 3 || argument % 7 === 4);
      if (flag) {
        if (ch !== "0" && ch !== "1") throw new Error(`bad arc flag at ${i}`);
        out.push(Number(ch));
        i++;
      } else {
        const m = NUMBER.exec(d.slice(i));
        if (!m) throw new Error(`unreadable path data at ${i}`);
        out.push(Number(m[0]));
        i += m[0].length;
      }
      argument++;
    }
  }
  return out;
}

// The arc from (x1, y1) to (x2, y2) as cubics of at most a quarter turn each (SVG 1.1, F.6.5 and
// F.6.6: the endpoint form to the centre form, radii scaled up when too small).
function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  rotation: number,
  large: number,
  sweep: number,
  x2: number,
  y2: number,
): [number, number, number, number, number, number][] {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * yp) / ry;
  const cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let delta = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const parts = Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9);
  const step = delta / parts;
  const t = (4 / 3) * Math.tan(step / 4);
  const point = (a: number): [number, number] => [
    cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin,
    cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos,
  ];
  const tangent = (a: number): [number, number] => [
    -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin,
    -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos,
  ];
  const curves: [number, number, number, number, number, number][] = [];
  for (let n = 0; n < parts; n++) {
    const a1 = theta + n * step;
    const a2 = a1 + step;
    const [px1, py1] = point(a1);
    const [tx1, ty1] = tangent(a1);
    const [px2, py2] = n === parts - 1 ? [x2, y2] : point(a2);
    const [tx2, ty2] = tangent(a2);
    curves.push([px1 + t * tx1, py1 + t * ty1, px2 - t * tx2, py2 - t * ty2, px2, py2]);
  }
  return curves;
}

export function absoluteCubics(d: string): PathCommand[] {
  const list = tokens(d);
  const out: PathCommand[] = [];
  // Kept unrounded, so a long run of relative commands does not drift.
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last control point, for S (after C or S) and T (after Q or T); null otherwise.
  let cubic: [number, number] | null = null;
  let quad: [number, number] | null = null;
  const line = (nx: number, ny: number) => {
    out.push(["L", round(nx), round(ny)]);
    x = nx;
    y = ny;
  };
  const curve = (c1x: number, c1y: number, c2x: number, c2y: number, nx: number, ny: number) => {
    out.push(["C", round(c1x), round(c1y), round(c2x), round(c2y), round(nx), round(ny)]);
    x = nx;
    y = ny;
  };

  let i = 0;
  while (i < list.length) {
    const letter = list[i++];
    if (typeof letter !== "string") throw new Error(`path data starts with a number: ${d}`);
    const upper = letter.toUpperCase();
    const relative = letter !== upper;
    const arity = ARITY[upper]!;
    let first = true;
    do {
      const a = list.slice(i, i + arity);
      if (a.length < arity || a.some((v) => typeof v !== "number"))
        throw new Error(`missing arguments for ${letter} in ${d}`);
      const n = a as number[];
      i += arity;
      const ox = relative ? x : 0;
      const oy = relative ? y : 0;
      let nextCubic: [number, number] | null = null;
      let nextQuad: [number, number] | null = null;
      switch (upper) {
        case "M":
          if (first) {
            x = n[0]! + ox;
            y = n[1]! + oy;
            startX = x;
            startY = y;
            out.push(["M", round(x), round(y)]);
          } else line(n[0]! + ox, n[1]! + oy);
          break;
        case "L":
          line(n[0]! + ox, n[1]! + oy);
          break;
        case "H":
          line(n[0]! + ox, y);
          break;
        case "V":
          line(x, n[0]! + oy);
          break;
        case "C":
          nextCubic = [n[2]! + ox, n[3]! + oy];
          curve(n[0]! + ox, n[1]! + oy, nextCubic[0], nextCubic[1], n[4]! + ox, n[5]! + oy);
          break;
        case "S": {
          const c1: [number, number] = cubic ? [2 * x - cubic[0], 2 * y - cubic[1]] : [x, y];
          nextCubic = [n[0]! + ox, n[1]! + oy];
          curve(c1[0], c1[1], nextCubic[0], nextCubic[1], n[2]! + ox, n[3]! + oy);
          break;
        }
        case "Q":
        case "T": {
          const q: [number, number] =
            upper === "Q"
              ? [n[0]! + ox, n[1]! + oy]
              : quad
                ? [2 * x - quad[0], 2 * y - quad[1]]
                : [x, y];
          const ex = (upper === "Q" ? n[2]! : n[0]!) + ox;
          const ey = (upper === "Q" ? n[3]! : n[1]!) + oy;
          nextQuad = q;
          // A quadratic is the cubic whose controls sit two thirds of the way to its one control.
          curve(
            x + (2 / 3) * (q[0] - x),
            y + (2 / 3) * (q[1] - y),
            ex + (2 / 3) * (q[0] - ex),
            ey + (2 / 3) * (q[1] - ey),
            ex,
            ey,
          );
          break;
        }
        case "A": {
          const ex = n[5]! + ox;
          const ey = n[6]! + oy;
          for (const c of arcToCubics(x, y, n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, ex, ey)) curve(...c);
          x = ex;
          y = ey;
          break;
        }
        case "Z":
          out.push(["Z"]);
          x = startX;
          y = startY;
          break;
      }
      cubic = nextCubic;
      quad = nextQuad;
      first = false;
    } while (arity > 0 && typeof list[i] === "number");
  }
  return out;
}
