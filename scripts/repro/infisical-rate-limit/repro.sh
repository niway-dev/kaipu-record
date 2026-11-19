#!/usr/bin/env bash
# Reproduce Infisical CLI rate limiting (HTTP 429) under a normal local
# development workload, against a throwaway folder of fake secrets.
#
#   repro.sh setup                      create /infisical-repro with fake secrets
#   repro.sh flow [CHECKOUTS] [STARTS]  replay `bun dev` starts (default 3 checkouts, 5 starts)
#   repro.sh edit [SECONDS]             edit a fake value every 3 s (run in a second terminal)
#   repro.sh stress [WORKERS] [SECONDS] sustained parallel reads (default 8 workers, 60 s)
#   repro.sh cleanup                    delete /infisical-repro
#
# Run from a directory with a .infisical.json, or set INFISICAL_PROJECT_ID.
# INFISICAL_ENV selects the environment slug (default: dev).
#
# Secret values are never printed. Every failed call is logged with its time,
# HTTP status and Infisical request id, so the calls can be found server side.
set -uo pipefail

ENV_SLUG="${INFISICAL_ENV:-dev}"
ROOT_FOLDER="infisical-repro"
# Mirrors the six folders the real project reads; `infisical export` has no
# --recursive, so every folder costs one call per consumer.
SUBFOLDERS=(public database cloudflare auth email signing)
LOG_DIR="${LOG_DIR:-$(pwd)/infisical-repro-logs}"

PROJECT_ARGS=()
[ -n "${INFISICAL_PROJECT_ID:-}" ] && PROJECT_ARGS=(--projectId="$INFISICAL_PROJECT_ID")

inf() { infisical "$@" --env="$ENV_SLUG" ${PROJECT_ARGS[@]+"${PROJECT_ARGS[@]}"} --silent </dev/null; }
fake() { LC_ALL=C tr -dc 'a-zA-Z0-9' </dev/urandom | head -c 24; }
now() { date +%H:%M:%S; }

# <log> <label> <infisical args...>: run one call, log OK or FAIL + diagnostics.
call() {
  local log="$1" label="$2"; shift 2
  local err rc
  err=$(inf "$@" 2>&1 >/dev/null); rc=$?
  if [ $rc -eq 0 ]; then
    echo "$(now) $label OK" >>"$log"
  else
    echo "$(now) $label FAIL :: $(printf '%s' "$err" |
      grep -oE 'status-code=[0-9]+|Response Code: [0-9]+|request-id=[A-Za-z0-9-]+|Request ID: [A-Za-z0-9-]+|Rate limit exceeded[^"]*|EOF' |
      sort -u | tr '\n' ' ')" >>"$log"
  fi
  return $rc
}

summary() {
  local all; all=$(cat "$LOG_DIR"/*.log 2>/dev/null)
  echo
  echo "calls:    $(grep -cE ' OK$| FAIL ' <<<"$all")"
  echo "failures: $(grep -c ' FAIL ' <<<"$all")"
  echo "calls per wall-clock minute:"
  grep -E ' OK$| FAIL ' <<<"$all" | awk '{split($1,t,":"); m=t[1]":"t[2]; n[m]++; if ($0 ~ / FAIL /) f[m]++}
    END {for (k in n) printf "  %s  %4d calls  %4d failed\n", k, n[k], f[k]}' | sort
  grep ' FAIL ' <<<"$all" | sort | head -10
  echo "full logs: $LOG_DIR"
}

# One `bun dev` start as it was before the project moved to generated .env
# files: three Workers each export six folders in sequence (stopping at the
# first failure, as `set -e` did), while the desktop app runs `infisical run`.
dev_start() {
  local log="$1" consumer
  for consumer in console server web; do
    (
      for f in "${SUBFOLDERS[@]}"; do
        call "$log" "$consumer export /$ROOT_FOLDER/$f" export --path="/$ROOT_FOLDER/$f" ||
          { echo "$(now) $consumer DEV START FAILED" >>"$log"; exit; }
      done
    ) &
  done
  call "$log" "desktop run" run --path="/$ROOT_FOLDER" --recursive -- true &
  wait
}

case "${1:-}" in
  setup)
    inf secrets folders create --path=/ --name="$ROOT_FOLDER" >/dev/null || exit 1
    for f in "${SUBFOLDERS[@]}"; do
      inf secrets folders create --path="/$ROOT_FOLDER" --name="$f" >/dev/null || exit 1
      up=$(printf "%s" "$f" | tr a-z A-Z)
      inf secrets set --path="/$ROOT_FOLDER/$f" \
        "FAKE_${up}_URL=https://example.invalid/$(fake)" "FAKE_${up}_KEY=$(fake)" >/dev/null || exit 1
    done
    inf secrets set --path="/$ROOT_FOLDER" FAKE_COUNTER=0 >/dev/null || exit 1
    echo "created /$ROOT_FOLDER with ${#SUBFOLDERS[@]} subfolders of fake secrets in '$ENV_SLUG'"
    ;;

  flow)
    CHECKOUTS="${2:-3}"; STARTS="${3:-5}"
    mkdir -p "$LOG_DIR"; rm -f "$LOG_DIR"/*.log
    echo "each start = 3 consumers x ${#SUBFOLDERS[@]} exports + 1 run = $((3 * ${#SUBFOLDERS[@]} + 1)) calls per checkout"
    for s in $(seq 1 "$STARTS"); do
      echo "$(now) start #$s: $CHECKOUTS checkouts run bun dev at once"
      for c in $(seq 1 "$CHECKOUTS"); do dev_start "$LOG_DIR/checkout$c.log" & done
      wait
      [ "$s" -lt "$STARTS" ] && sleep 10   # the pause in which a value is edited and dev restarted
    done
    summary
    ;;

  edit)
    SEC="${2:-90}"; end=$((SECONDS + SEC)); i=0
    mkdir -p "$LOG_DIR"
    while [ "$SECONDS" -lt "$end" ]; do
      i=$((i + 1))
      call "$LOG_DIR/edit.log" "edit #$i" secrets set --path="/$ROOT_FOLDER" "FAKE_COUNTER=$i"
      tail -1 "$LOG_DIR/edit.log"
      sleep 3
    done
    ;;

  stress)
    WORKERS="${2:-8}"; SEC="${3:-60}"
    mkdir -p "$LOG_DIR"; rm -f "$LOG_DIR"/*.log
    end=$((SECONDS + SEC))
    for w in $(seq 1 "$WORKERS"); do
      (
        while [ "$SECONDS" -lt "$end" ]; do
          call "$LOG_DIR/worker$w.log" "w$w export" export --path="/$ROOT_FOLDER/public"
          call "$LOG_DIR/worker$w.log" "w$w run" run --path="/$ROOT_FOLDER" --recursive -- true
        done
      ) &
    done
    echo "$WORKERS workers for ${SEC}s"
    wait
    summary
    ;;

  cleanup)
    inf secrets folders delete --path=/ --name="$ROOT_FOLDER" >/dev/null || exit 1
    echo "deleted /$ROOT_FOLDER"
    ;;

  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
