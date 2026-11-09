#!/usr/bin/env python3
"""Draws the BELΛY logotype and the lockup as outlines, so no file needs a font to show them.

Usage: python3 apps/web/scripts/draw-logotype.py apps/apple/Belay/ArchivoExpanded-ExtraBold.ttf

B, E, L and Y are Archivo Expanded ExtraBold's own outlines; the A is the peak, a crossbar-less
A with a shoulder on the climb. The letters are set at 200 px to the em, the size the peak was
drawn at, with the display face's 0.01 em tracking and 0.02 em more around the peak.
Run by hand; commit the output. Reads the TrueType tables directly to need no package.
"""
import os
import struct
import sys

PEAK_D = "M0 137.6 L31 71 L45 83 L95 -3 L186 137.6 L138 137.6 L95 72.6 L50 137.6 Z"
PEAK_BOX = (186.6, 137.6)
EM = 200
TRACKING = 0.01 * EM
PEAK_MARGIN = 0.02 * EM
# The lockup as validated: a 64 px mark box beside 46 px capitals (cap height 0.688 em), 18 px apart.
CAP = 46 * 0.688
MARK_PER_CAP = 64 / CAP
GAP_PER_CAP = 18 / CAP

RING_D = "M28.6 78.8 A37 37 0 1 1 71.4 78.8"
MOUNTAIN_D = "M28.6 78.8 L39 58 L45 64 L56 44 L71.4 78.8"
INK, BLUE, PAPER, LIGHT_BLUE = "#12181C", "#1F4E8C", "#F3F5F5", "#8DB6EE"
VERSIONS = {"light": (INK, BLUE), "dark": (PAPER, LIGHT_BLUE), "ink": (INK, INK)}


class Font:
    def __init__(self, path):
        self.data = open(path, "rb").read()
        count = struct.unpack(">H", self.data[4:6])[0]
        self.tables = {}
        for i in range(count):
            tag, _, offset, length = struct.unpack(">4sIII", self.data[12 + 16 * i : 28 + 16 * i])
            self.tables[tag.decode()] = (offset, length)
        head = self.table("head")
        self.upm = struct.unpack(">H", head[18:20])[0]
        self.long_loca = struct.unpack(">h", head[50:52])[0] == 1
        self.metrics = struct.unpack(">H", self.table("hhea")[34:36])[0]

    def table(self, tag):
        offset, length = self.tables[tag]
        return self.data[offset : offset + length]

    def glyph_id(self, char):
        cmap = self.table("cmap")
        for i in range(struct.unpack(">H", cmap[2:4])[0]):
            platform, encoding, offset = struct.unpack(">HHI", cmap[4 + 8 * i : 12 + 8 * i])
            if platform == 3 and encoding == 1 and struct.unpack(">H", cmap[offset : offset + 2])[0] == 4:
                return self._format4(cmap[offset:], ord(char))
        raise ValueError("no Windows Unicode format 4 cmap")

    @staticmethod
    def _format4(t, code):
        segs = struct.unpack(">H", t[6:8])[0] // 2
        ends = struct.unpack(f">{segs}H", t[14 : 14 + 2 * segs])
        at = 16 + 2 * segs
        starts = struct.unpack(f">{segs}H", t[at : at + 2 * segs])
        deltas = struct.unpack(f">{segs}h", t[at + 2 * segs : at + 4 * segs])
        ranges_at = at + 4 * segs
        ranges = struct.unpack(f">{segs}H", t[ranges_at : ranges_at + 2 * segs])
        for i in range(segs):
            if starts[i] <= code <= ends[i]:
                if ranges[i] == 0:
                    return (code + deltas[i]) & 0xFFFF
                where = ranges_at + 2 * i + ranges[i] + 2 * (code - starts[i])
                gid = struct.unpack(">H", t[where : where + 2])[0]
                return (gid + deltas[i]) & 0xFFFF if gid else 0
        raise ValueError(f"{chr(code)} is not in the font")

    def advance(self, gid):
        hmtx = self.table("hmtx")
        i = min(gid, self.metrics - 1)
        return struct.unpack(">H", hmtx[4 * i : 4 * i + 2])[0]

    def contours(self, gid):
        loca = self.table("loca")
        if self.long_loca:
            start, end = struct.unpack(">II", loca[4 * gid : 4 * gid + 8])
        else:
            start, end = (2 * v for v in struct.unpack(">HH", loca[2 * gid : 2 * gid + 4]))
        g = self.table("glyf")[start:end]
        n = struct.unpack(">h", g[0:2])[0]
        if n < 0:
            raise ValueError("composite glyphs are not drawn")
        ends = struct.unpack(f">{n}H", g[10 : 10 + 2 * n])
        at = 10 + 2 * n
        at += 2 + struct.unpack(">H", g[at : at + 2])[0]
        total = ends[-1] + 1
        flags = []
        while len(flags) < total:
            f = g[at]
            at += 1
            flags.append(f)
            if f & 8:
                flags.extend([f] * g[at])
                at += 1
        coords = []
        for short, same in ((2, 16), (4, 32)):
            v, values = 0, []
            for f in flags:
                if f & short:
                    d = g[at]
                    at += 1
                    v += d if f & same else -d
                elif not f & same:
                    v += struct.unpack(">h", g[at : at + 2])[0]
                    at += 2
                values.append(v)
            coords.append(values)
        points = [(x, y, bool(f & 1)) for x, y, f in zip(coords[0], coords[1], flags)]
        out, first = [], 0
        for last in ends:
            out.append(points[first : last + 1])
            first = last + 1
        return out


def num(v):
    return f"{v:.2f}".rstrip("0").rstrip(".") if abs(v) >= 0.005 else "0"


def outline(contours, x0, scale, baseline):
    """SVG path of TrueType quadratic contours, y flipped onto the baseline."""
    p = lambda pt: f"{num(x0 + pt[0] * scale)} {num(baseline - pt[1] * scale)}"
    d = []
    for c in contours:
        # Start on an on-curve point; between two off-curve points lies an implied on-curve one.
        k = next((i for i, pt in enumerate(c) if pt[2]), None)
        if k is None:
            c = [((c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2, True)] + c
            k = 0
        c = c[k:] + c[:k]
        d.append(f"M{p(c[0])}")
        control = None
        for pt in c[1:] + [c[0]]:
            if pt[2]:
                d.append(f"Q{p(control)} {p(pt)}" if control else f"L{p(pt)}")
                control = None
            elif control:
                mid = ((control[0] + pt[0]) / 2, (control[1] + pt[1]) / 2)
                d.append(f"Q{p(control)} {p(mid)}")
                control = pt
            else:
                control = pt
        d.append("Z")
    return " ".join(d)


def word(font):
    """The logotype's paths and its ink box, the pen starting at 0 and the capitals' top at 0."""
    scale = EM / font.upm
    cap = max(y for c in font.contours(font.glyph_id("E")) for _, y, _ in c) * scale
    k = cap / PEAK_BOX[1]
    letters, x, xs = [], 0.0, []
    for char in "BELAY":
        if char == "A":
            x += PEAK_MARGIN
            peak = (x, k)
            xs += [x, x + 186 * k]
            x += PEAK_BOX[0] * k + PEAK_MARGIN + TRACKING
            continue
        gid = font.glyph_id(char)
        contours = font.contours(gid)
        xs += [x + px * scale for c in contours for px, _, _ in c]
        letters.append(outline(contours, x, scale, cap))
        x += font.advance(gid) * scale + TRACKING
    return letters, peak, cap, (min(xs), -3 * k, max(xs), cap)


def word_paths(letters, peak, colours):
    ink, accent = colours
    out = [f'<path d="{d}" fill="{ink}"/>' for d in letters]
    out.insert(3, f'<path d="{PEAK_D}" fill="{accent}" transform="translate({num(peak[0])} 0) scale({peak[1]:.6f})"/>')
    return "\n    ".join(out)


def main(font_path):
    font = Font(font_path)
    letters, peak, cap, (x0, y0, x1, y1) = word(font)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
    mark_box = MARK_PER_CAP * cap
    left = mark_box + GAP_PER_CAP * cap
    top = (mark_box - cap) / 2
    for version, colours in VERSIONS.items():
        body = word_paths(letters, peak, colours)
        with open(os.path.join(out, f"logotype-{version}.svg"), "w") as f:
            f.write(
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{num(x0)} {num(y0)} {num(x1 - x0)} {num(y1 - y0)}">\n'
                f"  <g>\n    {body}\n  </g>\n</svg>\n"
            )
        ring, mountain = (INK, BLUE) if version == "light" else (PAPER, LIGHT_BLUE) if version == "dark" else (INK, INK)
        with open(os.path.join(out, f"lockup-{version}.svg"), "w") as f:
            f.write(
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {num(left + x1)} {num(mark_box)}">\n'
                f'  <g transform="scale({mark_box / 100:.6f})">\n'
                f'    <g transform="translate(0 1)" fill="none" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">\n'
                f'      <path d="{RING_D}" stroke="{ring}"/>\n'
                f'      <path d="{MOUNTAIN_D}" stroke="{mountain}"/>\n'
                f"    </g>\n  </g>\n"
                f'  <g transform="translate({num(left)} {num(top)})">\n    {body}\n  </g>\n</svg>\n'
            )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
