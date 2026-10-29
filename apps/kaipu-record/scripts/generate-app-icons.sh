#!/usr/bin/env bash
set -euo pipefail

# Derives every OS-facing app icon from the brand package's source, so the Dock,
# ⌘-Tab, Finder and the DMG can never lag behind the logo the app itself shows.
#
#   source:  packages/brand/assets/logo-app.svg   (the `app` purpose, see brand/src/index.ts)
#   outputs: build/icon.icns       packaged macOS app (electron-builder buildResources)
#            build/icon.png        1024 px, electron-builder's fallback / Linux
#            build/icon.ico        Windows: the .exe, the installer, the uninstaller,
#                                  the shortcuts and the installer's progress banner
#            resources/icon.png    512 px, the dev-run Dock icon and the Linux window icon
#            build/icon.source.sha256   hash of every brand source + this script and its
#                                       .ico packer; a vitest test fails when it no longer
#                                       matches, i.e. when the logo changed and nobody
#                                       re-ran this script
#            build/icon.outputs.sha256  hash of every file written here; the same test
#                                       fails when a shipped icon is not one of them, or
#                                       was replaced by hand after generation
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
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$APP_DIR/../.." && pwd)"
SOURCE="$ROOT/packages/brand/assets/logo-app.svg"
PLAIN="$ROOT/packages/brand/assets/logo-plain.svg"
SCRIPT="$APP_DIR/scripts/generate-app-icons.sh"
PACKER="$APP_DIR/scripts/png-to-ico.mjs"
# Every input, in the order the stamp hashes them (src/main/app-icon.test.ts reads the same list).
INPUTS=(
  "$SOURCE"
  "$PLAIN"
  "$ROOT/packages/brand/assets/mono-record.svg"
  "$ROOT/packages/brand/assets/mono-screenshot.svg"
  "$SCRIPT"
  "$PACKER"
)

CANVAS=1024
BODY=824
MARGIN=$(((CANVAS - BODY) / 2))

for tool in sips iconutil shasum node; do
  command -v "$tool" >/dev/null || {
    echo "✗ $tool not found — this script runs on macOS, with node for the .ico packer." >&2
    exit 1
  }
done
for input in "${INPUTS[@]}"; do
  [ -f "$input" ] || {
    echo "✗ source not found: $input" >&2
    exit 1
  }
done

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

echo "✓ app icons regenerated from packages/brand/assets/logo-app.svg"
echo "  build/icon.icns, build/icon.png, resources/icon.png"

# Windows app icon. Windows draws no grid around an app icon, so the artwork fills
# the canvas instead of sitting in Apple's margin. Below 48 px it is the plain fox:
# the frame corners turn into a grey fringe that small (the `micro` rule in
# packages/brand/src/index.ts). Sizes are the ones the shell asks for, from the
# 16 px title bar to the 256 px large-icon view.
#
# render_full <brand svg> <px> <out.png>: rasterise the artwork edge to edge.
render_full() {
  local source="$1" px="$2" out="$3" svg="$WORK/full-$(basename "$1" .svg)-$2.svg"
  tr '\n' ' ' <"$source" |
    sed -E 's/<\?xml[^>]*\?>//' |
    sed -E "1s/<svg([^>]*) width=\"[^\"]*\"/<svg\1 width=\"$px\"/; 1s/<svg([^>]*) height=\"[^\"]*\"/<svg\1 height=\"$px\"/" >"$svg"
  sips -s format png "$svg" --out "$out" >/dev/null
}

win_pngs=()
for px in 16 24 32 48 64 128 256; do
  art="$SOURCE"
  [ "$px" -lt 48 ] && art="$PLAIN"
  render_full "$art" "$px" "$WORK/win-$px.png"
  win_pngs+=("$WORK/win-$px.png")
done
node "$PACKER" "$APP_DIR/build/icon.ico" "${win_pngs[@]}"

echo "✓ Windows app icon regenerated from logo-app.svg (48–256 px) and logo-plain.svg (16–32 px)"
echo "  build/icon.ico"

# Windows tray icons. The macOS menu bar uses black template PNGs that the OS
# recolours; the Windows taskbar does not, and it is dark by default, so the
# tray needs a light glyph of its own. Same artwork as the template PNGs (the
# brand's mono cuts), recoloured white, centred on a transparent square, at the
# sizes the notification area asks for (16 px at 100 %, 24 at 150 %, 32 at 200 %).
#
#   outputs: resources/tray-windows-recording.ico    (Record mode, mono-record.svg)
#            resources/tray-windows-screenshot.ico   (Screenshot mode, mono-screenshot.svg)

# tray_ico <brand svg> <out.ico>
tray_ico() {
  local source="$1" out="$2" name w h side glyph
  name="$(basename "$source" .svg)"
  w="$(sed -nE '1s/.*<svg[^>]* width="([0-9.]+)".*/\1/p' "$source")"
  h="$(sed -nE '1s/.*<svg[^>]* height="([0-9.]+)".*/\1/p' "$source")"
  side=$((w > h ? w : h))
  glyph="$(tr '\n' ' ' <"$source" |
    sed -E 's/<\?xml[^>]*\?>//' |
    sed -E '1s/<svg([^>]*) width="[^"]*"/<svg\1/; 1s/<svg([^>]*) height="[^"]*"/<svg\1/' |
    sed -E 's/(fill|stroke)="black"/\1="white"/g' |
    sed -E "1s/<svg /<svg x=\"$(((side - w) / 2))\" y=\"$(((side - h) / 2))\" width=\"$w\" height=\"$h\" /")"
  local pngs=()
  for px in 16 24 32; do
    local svg="$WORK/$name-$px.svg" png="$WORK/$name-$px.png"
    printf '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">%s</svg>\n' \
      "$px" "$px" "$side" "$side" "$glyph" >"$svg"
    sips -s format png "$svg" --out "$png" >/dev/null
    pngs+=("$png")
  done
  node "$APP_DIR/scripts/png-to-ico.mjs" "$out" "${pngs[@]}"
}

tray_ico "$ROOT/packages/brand/assets/mono-record.svg" "$APP_DIR/resources/tray-windows-recording.ico"
tray_ico "$ROOT/packages/brand/assets/mono-screenshot.svg" "$APP_DIR/resources/tray-windows-screenshot.ico"

echo "✓ Windows tray icons regenerated from packages/brand/assets/mono-*.svg"
echo "  resources/tray-windows-recording.ico, resources/tray-windows-screenshot.ico"

cat "${INPUTS[@]}" | shasum -a 256 | awk '{print $1}' >"$APP_DIR/build/icon.source.sha256"
(
  cd "$APP_DIR"
  shasum -a 256 build/icon.icns build/icon.png build/icon.ico resources/icon.png \
    resources/tray-windows-recording.ico resources/tray-windows-screenshot.ico
) >"$APP_DIR/build/icon.outputs.sha256"

echo "✓ build/icon.source.sha256, build/icon.outputs.sha256"
