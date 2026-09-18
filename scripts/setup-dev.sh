#!/usr/bin/env bash
# Developer setup. Idempotent: anything already present is skipped, so it is
# safe to re-run at any time.
#
# Installs the tooling this repo needs that does not come from `bun install` —
# currently just the Infisical CLI, which every dev/db script shells out to.
set -uo pipefail

# Pinned so every machine and CI run gets the same CLI. Infisical's own docs
# recommend pinning rather than tracking latest.
INFISICAL_VERSION="0.43.132"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
skip() { printf '  \033[90m·\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; }

printf '\n\033[1mKaipu dev setup\033[0m\n\n'

# --- bun -------------------------------------------------------------------
if command -v bun >/dev/null 2>&1; then
  skip "bun $(bun --version) already installed"
else
  fail "bun is missing — install it from https://bun.sh, then re-run this script"
  exit 1
fi

# --- Infisical CLI ---------------------------------------------------------
# Three strategies, in order of preference. The binary fallback exists because
# Homebrew refuses to install anything when Xcode is outdated, even for a
# formula like this one that only downloads a prebuilt binary and never
# compiles. Rather than force an Xcode update, we fetch the same release
# artifact the formula would.
install_infisical_binary() {
  local arch tmp url
  case "$(uname -m)" in
    arm64)  arch="darwin_arm64" ;;
    x86_64) arch="darwin_amd64" ;;
    *)      fail "unsupported architecture: $(uname -m)"; return 1 ;;
  esac

  url="https://github.com/Infisical/cli/releases/download/v${INFISICAL_VERSION}/cli_${INFISICAL_VERSION}_${arch}.tar.gz"
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  curl -fsSL "$url" -o "$tmp/cli.tar.gz" || { fail "download failed: $url"; return 1; }
  tar -xzf "$tmp/cli.tar.gz" -C "$tmp" || { fail "could not extract the archive"; return 1; }

  mkdir -p "$HOME/.local/bin"
  mv "$tmp/infisical" "$HOME/.local/bin/infisical" || return 1
  chmod +x "$HOME/.local/bin/infisical"

  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) warn "add \$HOME/.local/bin to your PATH to use it in new shells" ;;
  esac
}

if command -v infisical >/dev/null 2>&1; then
  skip "infisical $(infisical --version 2>/dev/null | awk '{print $NF}') already installed"
elif command -v brew >/dev/null 2>&1 && brew install infisical/get-cli/infisical >/dev/null 2>&1; then
  ok "infisical installed via Homebrew"
else
  warn "Homebrew unavailable or refused — falling back to the release binary"
  if install_infisical_binary; then
    ok "infisical ${INFISICAL_VERSION} installed to ~/.local/bin"
    export PATH="$HOME/.local/bin:$PATH"
  else
    fail "could not install the Infisical CLI"
    printf '\n    Install it manually, then re-run:\n'
    printf '      brew install infisical/get-cli/infisical\n\n'
    printf '    If Homebrew complains that Xcode is outdated, this points it at\n'
    printf '    the Command Line Tools instead and fixes it for every formula:\n'
    printf '      sudo xcode-select --switch /Library/Developer/CommandLineTools\n\n'
    exit 1
  fi
fi

# --- Smoke test ------------------------------------------------------------
# One check, not two: actually reading a secret proves the binary works, the
# session is valid, and this machine can reach the project. A separate "are you
# logged in?" probe would only add a second way to be wrong.
if infisical secrets --env=dev --recursive --silent >/dev/null 2>&1; then
  ok "can read the dev environment"
  printf '\n\033[1mDone.\033[0m  bun run dev\n\n'
else
  fail "cannot read secrets from the dev environment"
  printf '\n    Log in, then re-run this script:\n'
  printf '      infisical login\n\n'
  printf '    Already logged in? Check you have access to project\n'
  printf '    %s\n\n' "$(grep -o '"workspaceId": *"[^"]*"' .infisical.json 2>/dev/null | cut -d'"' -f4)"
  exit 1
fi
