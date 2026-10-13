#!/usr/bin/env bash
set -euo pipefail

# Derives every OS-facing app icon from the brand package's source, so the Dock,
# ⌘-Tab, Finder and the DMG can never lag behind the logo the app itself shows.
#
#   source:  packages/brand/assets/logo-app.svg   (the `app` purpose, see brand/src/index.ts)
#   outputs: build/icon.icns       packaged macOS app (electron-builder buildResources)
#            build/icon.png        1024 px, electron-builder's fallback / Linux
#            resources/icon.png    512 px, the dev-run Dock icon and the Linux window icon
#            build/icon.source.sha256   hash of the source + this script; a vitest test
#                                       fails when it no longer matches, i.e. when the
#                                       logo changed and nobody re-ran this script
#
# macOS only: it uses the system `sips` (renders SVG) and `iconutil` (builds the
# .icns). Headless — no app opens, no window, no permission prompt.
#
#   bun run icons        (from apps/kaipu-record)
#
# The artwork is placed on Apple's app-icon grid: a 824 px body centred in a
# 1024 px canvas. Without that margin the icon renders visibly larger than every
# other icon in the Dock. Each size is rendered straight from the vector, so the
# small sizes are not downscaled blur and the large ones are not upscaled.
#
# Not covered: build/icon.ico (Windows). `sips` cannot write a multi-size .ico.

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$APP_DIR/../.." && pwd)"
SOURCE="$ROOT/packages/brand/assets/logo-app.svg"
SCRIPT="$APP_DIR/scripts/generate-app-icons.sh"

CANVAS=1024
BODY=824
MARGIN=$(((CANVAS - BODY) / 2))

for tool in sips iconutil shasum; do
  command -v "$tool" >/dev/null || {
    echo "✗ $tool not found — this script runs on macOS only." >&2
    exit 1
  }
done
[ -f "$SOURCE" ] || {
  echo "✗ source not found: $SOURCE" >&2
  exit 1
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kaipu-icons.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# The source's root <svg> becomes a nested <svg> positioned on the grid. Its own
# viewBox keeps the artwork's coordinates; only its outer size and offset change.
inner="$(tr '\n' ' ' <"$SOURCE" |
  sed -E 's/<\?xml[^>]*\?>//' |
  sed -E '1s/<svg([^>]*) width="[^"]*"/<svg\1/; 1s/<svg([^>]*) height="[^"]*"/<svg\1/' |
  sed -E "1s/<svg /<svg x=\"$MARGIN\" y=\"$MARGIN\" width=\"$BODY\" height=\"$BODY\" /")"

# render <px> <out.png>: rasterise the gridded artwork at exactly px × px.
render() {
  local px="$1" out="$2" svg="$WORK/icon-$1.svg"
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">%s</svg>\n' \
    "$px" "$px" "$CANVAS" "$CANVAS" "$inner" >"$svg"
  sips -s format png "$svg" --out "$out" >/dev/null
  local got
  got="$(sips -g pixelWidth "$out" | awk '/pixelWidth/ {print $2}')"
  [ "$got" = "$px" ] || {
    echo "✗ $out rendered at ${got}px, expected ${px}px" >&2
    exit 1
  }
}

ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  render "$size" "$ICONSET/icon_${size}x${size}.png"
  render "$((size * 2))" "$ICONSET/icon_${size}x${size}@2x.png"
done

iconutil -c icns "$ICONSET" -o "$APP_DIR/build/icon.icns"
cp "$ICONSET/icon_512x512@2x.png" "$APP_DIR/build/icon.png"
cp "$ICONSET/icon_256x256@2x.png" "$APP_DIR/resources/icon.png"

cat "$SOURCE" "$SCRIPT" | shasum -a 256 | awk '{print $1}' >"$APP_DIR/build/icon.source.sha256"

echo "✓ app icons regenerated from packages/brand/assets/logo-app.svg"
echo "  build/icon.icns, build/icon.png, resources/icon.png, build/icon.source.sha256"
