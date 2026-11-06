#!/usr/bin/env bash
# Cuts the display face the web app bundles (src/fonts/archivo-belay.woff2) from Archivo, under the
# SIL Open Font License (https://github.com/Omnibus-Type/Archivo):
#   apps/web/scripts/cut-display-face.sh <Archivo variable font or its Expanded ExtraBold instance>
# A variable font is instanced at width 125 and weight 800 first. The cut keeps Latin with the
# French marks, the narrow no-break space French puts before « ; : ! ? » and inside numbers, and the
# tabular figures; anything else falls back to the system face.
# Needs a Python with fontTools and brotli (pip install fonttools brotli; set PYTHON to use another
# one). Run by hand, not in CI; commit the output.
set -euo pipefail

src="${1:?usage: cut-display-face.sh <Archivo .ttf>}"
python="${PYTHON:-python3}"
out="$(cd "$(dirname "$0")/.." && pwd)/src/fonts/archivo-belay.woff2"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Basic Latin, Latin-1, œ Œ Ÿ, the typographic quotes and dashes, the ellipsis, the bullet, the
# thin and narrow no-break spaces, the euro, the trade mark and the minus sign.
unicodes="U+0020-007E,U+00A0-00FF,U+0152-0153,U+0178,U+2009,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2039-203A,U+202F,U+20AC,U+2122,U+2212"

$python - "$src" "$tmp/instance.ttf" <<'PY'
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

font = TTFont(sys.argv[1])
if "fvar" in font:
    font = instancer.instantiateVariableFont(font, {"wdth": 125, "wght": 800})
elif (font["OS/2"].usWeightClass, font["OS/2"].usWidthClass) != (800, 7):
    sys.exit("not Archivo at width 125 and weight 800, nor a variable Archivo")
# French sets U+202F inside numbers and before « ; : ! ? »: draw it as the thin space if the source
# leaves it out, so it never falls back to another face in the middle of a figure.
for table in font["cmap"].tables:
    if table.isUnicode() and 0x202F not in table.cmap and 0x2009 in table.cmap:
        table.cmap[0x202F] = table.cmap[0x2009]
font.save(sys.argv[2])
PY

$python -m fontTools.subset "$tmp/instance.ttf" \
  --unicodes="$unicodes" \
  --layout-features="kern,tnum,ccmp,locl" \
  --flavor=woff2 \
  --desubroutinize \
  --no-hinting \
  --name-IDs="0,1,2,3,4,5,6,13,14" \
  --output-file="$out"

$python - "$out" <<'PY'
import sys
from fontTools.ttLib import TTFont

cmap = TTFont(sys.argv[1]).getBestCmap()
missing = [hex(u) for u in (0x202F, 0x00E9, 0x0153, 0x00AB, 0x00BB, 0x20AC) if u not in cmap]
if missing:
    sys.exit(f"the cut lacks {missing}")
PY
echo "wrote $out ($(wc -c < "$out" | tr -d ' ') bytes)"
