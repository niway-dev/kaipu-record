#!/usr/bin/env bash
# Downloads the pinned sherpa-onnx release (ADR 0062) and installs the speech engine into
# resources/native/sherpa-onnx/{bin,lib}. Explicit, never a postinstall: packaging scripts and
# `bun run fetch:speech-engine` call it. What to fetch comes from scripts/speech-engine.lock only.
#
# - macOS arm64 only; elsewhere it exits 0 (the app shows "unavailable").
# - The archive goes into a fresh temp directory, its SHA-256 is checked against the lock BEFORE
#   it is extracted, and nothing is run from inside the temp directory.
# - Only the CLI, the version tool and the dylibs they need are copied, then run from the
#   destination once to prove they load.
# - The license texts (scripts/speech-engine-licenses/) are copied to licenses/ next to bin/ and
#   lib/: Apache-2.0 and MIT require the text to travel with every redistributed copy. The pinned
#   archive carries none of its own, so the repository holds them. The script fails if they are
#   missing, so a release cannot ship without.
# - Idempotent: a stamp holding the version and hash makes a repeat run a no-op.
set -euo pipefail

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo "fetch-speech-engine: the speech engine is macOS arm64 only; skipping on $(uname -s)/$(uname -m)."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCK="$SCRIPT_DIR/speech-engine.lock"
DEST="$APP_ROOT/resources/native/sherpa-onnx"
STAGE="$DEST.partial"
STAMP="$DEST/.engine-stamp"

lock_get() {
  local value
  # `|| true`: under pipefail a missing key would abort here, before the message below.
  value="$(grep -E "^$1=" "$LOCK" | head -n 1 | cut -d= -f2- || true)"
  if [[ -z "$value" ]]; then
    echo "fetch-speech-engine: $1 is missing from $LOCK" >&2
    exit 1
  fi
  printf '%s' "$value"
}

VERSION="$(lock_get SHERPA_VERSION)"
ARCHIVE="$(lock_get SHERPA_ARCHIVE)"
SHA256="$(lock_get SHERPA_SHA256)"
URL="$(lock_get SHERPA_URL)"
WANT_STAMP="version=$VERSION
sha256=$SHA256"

if [[ -x "$DEST/bin/sherpa-onnx-offline" && -f "$STAMP" && "$(cat "$STAMP")" == "$WANT_STAMP" ]] &&
  [[ -n "$(find "$DEST/licenses" -type f 2>/dev/null | head -n 1)" ]]; then
  echo "fetch-speech-engine: sherpa-onnx $VERSION already installed."
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "fetch-speech-engine: downloading $ARCHIVE"
curl --fail --location --silent --show-error --retry 3 --output "$WORK/$ARCHIVE" "$URL"

ACTUAL="$(shasum -a 256 "$WORK/$ARCHIVE" | cut -d' ' -f1)"
if [[ "$ACTUAL" != "$SHA256" ]]; then
  echo "fetch-speech-engine: SHA-256 mismatch for $ARCHIVE" >&2
  echo "  expected $SHA256" >&2
  echo "  actual   $ACTUAL" >&2
  exit 1
fi

mkdir "$WORK/extract"
tar -xjf "$WORK/$ARCHIVE" -C "$WORK/extract"
SRC="$(find "$WORK/extract" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ ! -x "$SRC/bin/sherpa-onnx-offline" || ! -x "$SRC/bin/sherpa-onnx-version" ]]; then
  echo "fetch-speech-engine: $ARCHIVE has no bin/sherpa-onnx-offline or bin/sherpa-onnx-version" >&2
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/bin" "$STAGE/lib"
cp "$SRC/bin/sherpa-onnx-offline" "$SRC/bin/sherpa-onnx-version" "$STAGE/bin/"

# Copy every @rpath dylib the two binaries need, and the ones those need in turn. The binaries
# carry `@loader_path/../lib` as an rpath, so bin/ next to lib/ is all the loader requires.
QUEUE=("$STAGE/bin/sherpa-onnx-offline" "$STAGE/bin/sherpa-onnx-version")
SEEN=" "
while ((${#QUEUE[@]} > 0)); do
  CURRENT="${QUEUE[0]}"
  QUEUE=("${QUEUE[@]:1}")
  while IFS= read -r NAME; do
    [[ -n "$NAME" && "$SEEN" != *" $NAME "* ]] || continue
    SEEN="$SEEN$NAME "
    if [[ ! -f "$SRC/lib/$NAME" ]]; then
      echo "fetch-speech-engine: $NAME is needed but is not in $ARCHIVE/lib" >&2
      exit 1
    fi
    cp "$SRC/lib/$NAME" "$STAGE/lib/$NAME"
    QUEUE+=("$STAGE/lib/$NAME")
  done < <(otool -L "$CURRENT" | awk '/@rpath\// { sub(".*@rpath/", "", $1); print $1 }')
done

# The license texts of what we redistribute. The pinned archive has no LICENSE, NOTICE or COPYING
# file, so they come from the repository; a missing folder is an error, never a silent omission.
LICENSES_SRC="$SCRIPT_DIR/speech-engine-licenses"
mkdir -p "$STAGE/licenses"
shopt -s nullglob
for FILE in "$LICENSES_SRC"/*; do
  if [[ -f "$FILE" ]]; then cp "$FILE" "$STAGE/licenses/"; fi
done
shopt -u nullglob
if [[ -z "$(find "$STAGE/licenses" -type f | head -n 1)" ]]; then
  echo "fetch-speech-engine: no license files in $LICENSES_SRC" >&2
  exit 1
fi

# Prove it loads from where it will live: the version tool names the release, --help starts the CLI.
VERSION_OUT="$("$STAGE/bin/sherpa-onnx-version" 2>&1)"
if ! grep -q "sherpa-onnx version : ${VERSION#v}\$" <<<"$VERSION_OUT"; then
  echo "fetch-speech-engine: the installed engine does not report ${VERSION#v}:" >&2
  echo "$VERSION_OUT" >&2
  exit 1
fi
"$STAGE/bin/sherpa-onnx-offline" --help >/dev/null 2>&1

printf '%s\n' "$WANT_STAMP" >"$STAGE/.engine-stamp"
rm -rf "$DEST"
mv "$STAGE" "$DEST"
echo "fetch-speech-engine: installed sherpa-onnx $VERSION into $DEST"
