#!/usr/bin/env bash
# Regenerates the web app's PNG icons, favicon.ico, the iPhone app's icon and the Android app's
# launcher and notification icons from the versioned SVG sources.
# Needs rsvg-convert and magick (Homebrew: librsvg, imagemagick). Run by hand, not in CI;
# commit the output.
set -euo pipefail

web="$(cd "$(dirname "$0")/../apps/web" && pwd)"
src="$web/icons/app-icon.svg"
out="$web/public"
ios="$(cd "$(dirname "$0")/../apps/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset" && pwd)"
res="$(cd "$(dirname "$0")/../apps/mobile/android/app/src/main/res" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for size in 64 192 512; do
  rsvg-convert -w "$size" -h "$size" "$src" -o "$out/pwa-${size}x${size}.png"
done
rsvg-convert -w 180 -h 180 "$src" -o "$out/apple-touch-icon-180x180.png"

# favicon.ico: the mark alone on transparent, light-scheme orange (the SVG's dark style is dropped).
sed 's|<style>.*</style>||' "$out/logo.svg" > "$tmp/mark.svg"
for size in 16 32 48; do
  rsvg-convert -w "$size" -h "$size" "$tmp/mark.svg" -o "$tmp/fav-$size.png"
done
magick "$tmp/fav-16.png" "$tmp/fav-32.png" "$tmp/fav-48.png" "$out/favicon.ico"

# The iPhone icon: one 1024 px image, iOS rounds the corners itself and refuses an alpha channel,
# so the transparent edge is filled with the light background.
rsvg-convert -w 1024 -h 1024 "$src" | magick - -background '#FAFAF7' -alpha remove -alpha off "$ios/AppIcon-512@2x.png"

# Android: the mark alone, from the favicon's path, drawn at its size on the iPhone icon (0.8529 of
# a 512 px tile) relative to the 72 dp an adaptive icon shows. That keeps it well inside the 66 dp
# safe zone every launcher mask leaves whole. The background is the launch colour, chalk or night.
mark="$(sed -n 's|.*<path d="\([^"]*\)".*|\1|p' "$out/logo.svg")"
layer() { # fill, file: one 108 dp adaptive layer
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108"><path d="%s" fill="%s" transform="translate(54 54) scale(%s) translate(-256 -256)"/></svg>' \
    "$mark" "$1" "$(echo "0.8529 * 72 / 512" | bc -l)" > "$2"
}
layer '#C2410C' "$tmp/foreground.svg"
# Themed icons keep only the monochrome layer's alpha and tint it themselves.
layer '#FFFFFF' "$tmp/monochrome.svg"
# The status bar icon: white on transparent, the mark in the 20 dp live area of a 24 dp icon.
printf '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="84 84 344 344"><path d="%s" fill="#FFFFFF" transform="translate(256 256) scale(%s) translate(-256 -256)"/></svg>' \
  "$mark" "$(echo "344 * 20 / 24 / 340" | bc -l)" > "$tmp/stat.svg"

for density in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  name="${density%%:*}"
  scale="${density##*:}"
  launcher="$(echo "108 * $scale / 1" | bc)"
  stat="$(echo "24 * $scale / 1" | bc)"
  mkdir -p "$res/mipmap-$name" "$res/drawable-$name"
  rsvg-convert -w "$launcher" -h "$launcher" "$tmp/foreground.svg" -o "$res/mipmap-$name/ic_launcher_foreground.png"
  rsvg-convert -w "$launcher" -h "$launcher" "$tmp/monochrome.svg" -o "$res/mipmap-$name/ic_launcher_monochrome.png"
  rsvg-convert -w "$stat" -h "$stat" "$tmp/stat.svg" -o "$res/drawable-$name/ic_stat_belay.png"
done

mkdir -p "$res/mipmap-anydpi-v26"
for icon in ic_launcher ic_launcher_round; do
  cat > "$res/mipmap-anydpi-v26/$icon.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/launch" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
XML
done
