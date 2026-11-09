#!/usr/bin/env bash
# Regenerates the web app's PNG icons, favicon.ico and the Android app's launcher and notification
# icons from the versioned SVG sources.
# Needs rsvg-convert and magick (Homebrew: librsvg, imagemagick). Run by hand, not in CI;
# commit the output.
set -euo pipefail

web="$(cd "$(dirname "$0")/../apps/web" && pwd)"
icons="$web/icons"
out="$web/public"
res="$(cd "$(dirname "$0")/../apps/mobile/android/app/src/main/res" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The drawing inside a mark source, without its <svg> wrapper.
inner() { sed '1d;$d' "$icons/$1.svg"; }

for size in 64 192 512; do
  rsvg-convert -w "$size" -h "$size" "$icons/app-icon.svg" -o "$out/pwa-${size}x${size}.png"
done
rsvg-convert -w 180 -h 180 "$icons/app-icon.svg" -o "$out/apple-touch-icon-180x180.png"

# The tab icon: the mark in colour light, its ring and mountain recoloured under the dark scheme.
style='  <style>@media (prefers-color-scheme: dark){path:first-child{stroke:#F3F5F5}path:last-child{stroke:#8DB6EE}}</style>'
{ head -1 "$icons/mark-light.svg"; echo "$style"; inner mark-light; tail -1 "$icons/mark-light.svg"; } > "$out/logo.svg"

# favicon.ico: the mark on a rounded paper tile. At 16 px the standard strokes would be 1.5 px
# and the summit would run into the ring, so that frame draws the small-size mark.
tile() { # source, file
  { printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#F3F5F5"/><g transform="translate(8 8) scale(0.84)">'
    inner "$1"; printf '</g></svg>'; } > "$2"
}
tile mark-small-light "$tmp/fav-16.svg"
tile mark-light "$tmp/fav-32.svg"
tile mark-light "$tmp/fav-48.svg"
for size in 16 32 48; do
  rsvg-convert -w "$size" -h "$size" "$tmp/fav-$size.svg" -o "$tmp/fav-$size.png"
done
magick "$tmp/fav-16.png" "$tmp/fav-32.png" "$tmp/fav-48.png" "$out/favicon.ico"

# Android: the mark alone, as wide as the old mark was on the web icon (0.8529 of a 512 px tile's
# 340 px drawing) relative to the 72 dp an adaptive icon shows: 85 of its 100 units span 40.8 dp,
# well inside the 66 dp safe zone every launcher mask leaves whole, and the page's launch mark
# keeps the width it has at the splash's handover. The ground is the `icon_ground` colour, so only
# the foreground changes between day (colour light) and night (colour dark).
layer() { # source, file: one 108 dp adaptive layer
  { printf '<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108"><g transform="translate(54 54) scale(%s) translate(-50 -50)">' \
      "$(echo "0.8529 * 340 / 512 * 72 / 85" | bc -l)"
    inner "$1"; printf '</g></svg>'; } > "$2"
}
layer mark-light "$tmp/foreground.svg"
layer mark-dark "$tmp/foreground-night.svg"
# Themed icons keep only the monochrome layer's alpha and tint it themselves.
layer mark-white "$tmp/monochrome.svg"
# The status bar icon: the small-size mark in white on transparent, its 85-unit width in the
# 20 dp live area of a 24 dp icon, its drawn box (y 7.1 to 85.3) centred.
{ printf '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 100 100"><g transform="translate(50 50) scale(%s) translate(-50 -46.2)">' \
    "$(echo "100 * 20 / 24 / 85" | bc -l)"
  inner mark-small-white; printf '</g></svg>'; } > "$tmp/stat.svg"

for density in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  name="${density%%:*}"
  scale="${density##*:}"
  launcher="$(echo "108 * $scale / 1" | bc)"
  stat="$(echo "24 * $scale / 1" | bc)"
  mkdir -p "$res/mipmap-$name" "$res/mipmap-night-$name" "$res/drawable-$name"
  rsvg-convert -w "$launcher" -h "$launcher" "$tmp/foreground.svg" -o "$res/mipmap-$name/ic_launcher_foreground.png"
  rsvg-convert -w "$launcher" -h "$launcher" "$tmp/foreground-night.svg" -o "$res/mipmap-night-$name/ic_launcher_foreground.png"
  rsvg-convert -w "$launcher" -h "$launcher" "$tmp/monochrome.svg" -o "$res/mipmap-$name/ic_launcher_monochrome.png"
  rsvg-convert -w "$stat" -h "$stat" "$tmp/stat.svg" -o "$res/drawable-$name/ic_stat_belay.png"
done

mkdir -p "$res/mipmap-anydpi-v26"
for icon in ic_launcher ic_launcher_round; do
  cat > "$res/mipmap-anydpi-v26/$icon.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/icon_ground" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
XML
done
