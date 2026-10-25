#!/usr/bin/env bash
# Regenerates the web app's PNG icons, favicon.ico and the iPhone app's icon from the versioned SVG
# sources.
# Needs rsvg-convert and magick (Homebrew: librsvg, imagemagick). Run by hand, not in CI;
# commit the output.
set -euo pipefail

web="$(cd "$(dirname "$0")/../apps/web" && pwd)"
src="$web/icons/app-icon.svg"
out="$web/public"
ios="$(cd "$(dirname "$0")/../apps/ios/ios/App/App/Assets.xcassets/AppIcon.appiconset" && pwd)"
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
