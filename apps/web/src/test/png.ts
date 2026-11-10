import { inflateSync } from "node:zlib";

// Pixels of an 8-bit RGB or RGBA, non-interlaced PNG, as RGBA rows.
export const decodePng = (b: Buffer) => {
  const [w, h] = [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[24] !== 8 || b[28] !== 0 || (b[25] !== 2 && b[25] !== 6))
    throw new Error("only 8-bit RGB or RGBA, non-interlaced PNGs are read");
  const bpp = b[25] === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let at = 8; at < b.length;) {
    const len = b.readUInt32BE(at);
    if (b.toString("ascii", at + 4, at + 8) === "IDAT")
      chunks.push(b.subarray(at + 8, at + 8 + len));
    at += len + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const row = w * bpp;
  const px = Buffer.alloc(row * h);
  for (let j = 0; j < h; j++) {
    const filter = raw[j * (row + 1)];
    for (let i = 0; i < row; i++) {
      const v = raw[j * (row + 1) + 1 + i]!;
      const a = i >= bpp ? px[j * row + i - bpp]! : 0;
      const up = j > 0 ? px[(j - 1) * row + i]! : 0;
      const c = i >= bpp && j > 0 ? px[(j - 1) * row + i - bpp]! : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = (a + up) >> 1;
      else if (filter === 4) {
        const base = a + up - c;
        const [pa, pb, pc] = [Math.abs(base - a), Math.abs(base - up), Math.abs(base - c)];
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      px[j * row + i] = (v + pred) & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    px.copy(rgba, p * 4, p * bpp, p * bpp + 3);
    rgba[p * 4 + 3] = bpp === 4 ? px[p * bpp + 3]! : 255;
  }
  return { width: w, height: h, rgba };
};
