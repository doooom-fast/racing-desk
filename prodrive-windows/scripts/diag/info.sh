#!/usr/bin/env bash
#
# Show server identity + reachable URLs + log cursor head for a running
# RaceCor Pro Drive diagnostic endpoint. Useful as a "is the pipe alive"
# probe before running watch.sh or pulling a snapshot.
#
# Usage:
#   scripts/diag/info.sh <host>[:port]

set -euo pipefail

host="${1:-}"
if [[ -z "$host" ]]; then
  echo "usage: $0 <host>[:port]" >&2
  exit 2
fi
if [[ "$host" != *:* ]]; then
  host="${host}:8891"
fi

resp=$(curl -sS --max-time 5 "http://${host}/diag/info") || {
  echo "unreachable: http://${host}/diag/info" >&2
  exit 1
}

if command -v jq >/dev/null 2>&1; then
  echo "$resp" | jq .
else
  echo "$resp"
fi
