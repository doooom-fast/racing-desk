#!/usr/bin/env bash
#
# Tail the live diagnostic stream from a running RaceCor Pro Drive on a
# remote machine. Polls /diag/tail every 500ms and appends new JSONL
# records to ~/.racecor-diag/live.jsonl while pretty-printing them.
#
# Usage:
#   scripts/diag/watch.sh <host>[:port]
#
# Examples:
#   scripts/diag/watch.sh 192.168.1.42
#   scripts/diag/watch.sh racecor-pc.tailnet:8891
#
# If port is omitted, defaults to 8891. Press ^C to stop; the log file
# is preserved so Claude (or any tool) can re-read the full session.

set -euo pipefail

host="${1:-}"
if [[ -z "$host" ]]; then
  echo "usage: $0 <host>[:port]" >&2
  exit 2
fi

if [[ "$host" != *:* ]]; then
  host="${host}:8891"
fi

base="http://${host}"
out_dir="${HOME}/.racecor-diag"
mkdir -p "$out_dir"
log_file="${out_dir}/live.jsonl"

# Require jq for pretty-printing; gracefully degrade to raw JSONL if missing.
pretty="cat"
if command -v jq >/dev/null 2>&1; then
  pretty='jq -rc ". | [.ts, .lvl, .cat, .msg] | @tsv"'
fi

echo "watching ${base}  →  ${log_file}" >&2

# Discover head sequence so we don't replay 5000 entries on every connect.
info=$(curl -sS --max-time 5 "${base}/diag/info" || true)
if [[ -z "$info" ]]; then
  echo "error: could not reach ${base}/diag/info" >&2
  exit 1
fi
since=$(echo "$info" | jq -r '.head // 0' 2>/dev/null || echo 0)
echo "starting at seq=${since}" >&2

trap 'echo; echo "stopped. log: ${log_file}" >&2' EXIT

while true; do
  resp=$(curl -sS --max-time 10 "${base}/diag/tail?since=${since}&max=2000" 2>/dev/null || true)
  if [[ -z "$resp" ]]; then
    sleep 1
    continue
  fi

  head=$(echo "$resp" | jq -r '.head // 0' 2>/dev/null || echo "$since")
  count=$(echo "$resp" | jq -r '.count // 0' 2>/dev/null || echo 0)

  # Detect server restart: head went backwards.
  if (( head < since )); then
    echo "[diag] server restarted (head=${head} < since=${since}); resetting cursor" >&2
    since=0
    continue
  fi

  if (( count > 0 )); then
    echo "$resp" | jq -c '.entries[]' 2>/dev/null | tee -a "$log_file" | eval "$pretty"
    since=$head
  fi

  sleep 0.5
done
