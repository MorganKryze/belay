// WCAG 2.x contrast ratio between two #rrggbb colours.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// The `--name: #rrggbb;`, rgba and `var(--other)` declarations of one CSS block, e.g. ":root" or
// ".dark". `indent` reads a block nested in a media query, written two spaces in.
export function readTokens(css: string, selector: string, indent = ""): Record<string, string> {
  const start = css.indexOf(`\n${indent}${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf(`\n${indent}}`, start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}|rgba\([^)]*\)|var\(--[\w-]+\));/gi)].map((m) => [
      m[1]!,
      m[2]!.toLowerCase(),
    ]),
  );
}

// Every `var(--other)` replaced by the colour it ends at, as the browser resolves the root's
// custom properties once the theme's blocks are all applied.
export function resolveTokens(tokens: Record<string, string>): Record<string, string> {
  const resolve = (value: string, seen: string[]): string => {
    const name = /^var\(--([\w-]+)\)$/.exec(value)?.[1];
    if (name === undefined) return value;
    const next = tokens[name];
    if (next === undefined || seen.includes(name)) throw new Error(`--${name} does not resolve`);
    return resolve(next, [...seen, name]);
  };
  return Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, resolve(v, [k])]));
}

// A translucent rgba colour laid on an opaque #rrggbb, as the #rrggbb the eye sees.
export function flatten(color: string, under: string): string {
  const parts = /rgba\(([^)]*)\)/.exec(color)?.[1]?.split(",").map(Number);
  if (parts?.length !== 4) throw new Error(`not an rgba colour: ${color}`);
  const [r, g, b, a] = parts as [number, number, number, number];
  return (
    "#" +
    [r, g, b]
      .map((top, i) => {
        const base = parseInt(under.slice(1 + 2 * i, 3 + 2 * i), 16);
        return Math.round(top * a + base * (1 - a))
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}
