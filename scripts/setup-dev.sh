#!/usr/bin/env bash
# Checks the global tools this repo needs. It NEVER installs anything.
#
# Why check instead of install: an install script that downloads binaries is a
# supply-chain surface — it runs before you have read it, and a fallback that
# curls a release tarball has no checksum to verify against, unlike the package
# manager it is standing in for. Printing the command you should run keeps the
# decision (and the verification) with you.
#
# Everything from `bun install` is out of scope — this covers only what has to
# exist on the machine beforehand.
set -uo pipefail

# --- required tools ---------------------------------------------------------
# One entry per tool:  name | min version | why it is needed | install command
# Leave the version empty to check presence only.
REQUIRED=(
  "bun|1.3.4|runs every script and the workspace install|https://bun.sh"
  "infisical|0.40.0|every dev and db script fetches secrets from Infisical|brew install infisical/get-cli/infisical"
)

# Optional: absence is reported but does not fail the check.
OPTIONAL=(
  "gh||opening and reviewing pull requests|brew install gh"
)

red=$'\033[31m'; green=$'\033[32m'; yellow=$'\033[33m'; dim=$'\033[90m'; bold=$'\033[1m'; off=$'\033[0m'
missing=0

version_of() {
  # Tools disagree on where the number sits, so take the first thing shaped
  # like a version from the first line.
  "$1" --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1
}

version_at_least() { # $1 = found, $2 = minimum
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]
}

check() { # $1 = entry, $2 = "required" | "optional"
  local name min why install found
  IFS='|' read -r name min why install <<<"$1"
  min="$(echo "$min" | tr -d '[:space:]')"

  if ! command -v "$name" >/dev/null 2>&1; then
    if [ "$2" = "required" ]; then
      printf '  %s✗%s %-12s %smissing%s\n' "$red" "$off" "$name" "$red" "$off"
      printf '       %sneeded for:%s %s\n' "$dim" "$off" "$why"
      printf '       %sinstall:%s    %s\n\n' "$dim" "$off" "$install"
      missing=$((missing + 1))
    else
      printf '  %s·%s %-12s %snot installed — %s%s\n' "$yellow" "$off" "$name" "$dim" "$why" "$off"
    fi
    return
  fi

  found="$(version_of "$name")"
  if [ -n "$min" ] && [ -n "$found" ] && ! version_at_least "$found" "$min"; then
    printf '  %s✗%s %-12s %s %s(need >= %s)%s\n' "$red" "$off" "$name" "$found" "$red" "$min" "$off"
    printf '       %supgrade:%s    %s\n\n' "$dim" "$off" "$install"
    missing=$((missing + 1))
    return
  fi

  printf '  %s✓%s %-12s %s\n' "$green" "$off" "$name" "${found:-present}"
}

printf '\n%sRequired tools%s\n' "$bold" "$off"
for entry in "${REQUIRED[@]}"; do check "$entry" required; done

printf '\n%sOptional%s\n' "$bold" "$off"
for entry in "${OPTIONAL[@]}"; do check "$entry" optional; done

if [ "$missing" -gt 0 ]; then
  printf '\n%s%d tool(s) missing.%s Install them with the commands above, then re-run.\n\n' "$red" "$missing" "$off"
  exit 1
fi

# --- native dependencies ----------------------------------------------------
# `uiohook-napi` ships prebuilds for Node, not for Electron, so it has to be
# rebuilt against Electron's ABI before the desktop app can load it. That rebuild
# used to be a `postinstall`; it is explicit now (scripts/rebuild-native.sh), so
# this is the thing that has to notice it is pending.
#
# Reported, never run: the rebuild invokes a C compiler, and the decision to do
# that stays with you — the same rule the tool checks above follow.
#
# Not fatal. Without it the app still runs; `click-hook.ts` degrades to "no
# clicks" rather than crashing, so the only casualty is auto-zoom on clicks. That
# silence is exactly why this check is here: nothing else would tell you.
printf '\n%sDesktop native dependencies%s\n' "$bold" "$off"
native_app_dir="apps/kaipu-record"
native_stamp="$native_app_dir/node_modules/.native-deps-electron-version"
native_electron_pkg="$native_app_dir/node_modules/electron/package.json"

if [ ! -f "$native_electron_pkg" ]; then
  printf '  %s·%s %-12s %snot installed yet — run bun install first%s\n' \
    "$yellow" "$off" "electron" "$dim" "$off"
else
  native_electron_version="$(node -p "require('./$native_electron_pkg').version" 2>/dev/null || echo "")"
  native_built_for="$(cat "$native_stamp" 2>/dev/null || echo "")"
  if [ -n "$native_electron_version" ] && [ "$native_built_for" = "$native_electron_version" ]; then
    printf '  %s✓%s %-12s built for Electron %s\n' "$green" "$off" "uiohook-napi" "$native_electron_version"
  else
    if [ -z "$native_built_for" ]; then
      printf '  %s·%s %-12s %snot built for Electron yet%s\n' \
        "$yellow" "$off" "uiohook-napi" "$dim" "$off"
    else
      printf '  %s·%s %-12s %sbuilt for Electron %s, installed is %s%s\n' \
        "$yellow" "$off" "uiohook-napi" "$dim" "$native_built_for" "$native_electron_version" "$off"
    fi
    printf '       %sneeded for:%s auto-zoom on clicks in the video editor\n' "$dim" "$off"
    printf '       %srun:%s        bun run rebuild:native\n' "$dim" "$off"
  fi
fi

# --- connectivity -----------------------------------------------------------
# Presence is not access. One real read proves the binary works, the session is
# valid, and this machine can reach the project — three failures that otherwise
# surface much later as a confusing crash inside an unrelated script.
printf '\n%sInfisical access%s\n' "$bold" "$off"
if infisical secrets --env=dev --recursive --silent >/dev/null 2>&1; then
  printf '  %s✓%s can read the dev environment\n' "$green" "$off"
  printf '\n%sReady.%s  bun run dev\n\n' "$bold" "$off"
else
  printf '  %s✗%s cannot read the dev environment\n\n' "$red" "$off"
  printf '       Log in, then re-run this script:\n'
  printf '         %sinfisical login%s\n\n' "$bold" "$off"
  printf '       %sAlready logged in? Confirm you have access to project%s\n' "$dim" "$off"
  printf '       %s%s%s\n\n' "$dim" "$(grep -o '"workspaceId": *"[^"]*"' .infisical.json 2>/dev/null | cut -d'"' -f4)" "$off"
  exit 1
fi
