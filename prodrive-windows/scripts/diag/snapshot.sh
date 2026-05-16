#!/usr/bin/env bash
#
# Pull a one-shot diagnostic snapshot (zip of every log file + system
# info JSON) from a running RaceCor Pro Drive on a remote machine.
#
# Usage:
#   scripts/diag/snapshot.sh <host>[:port] [out_dir]
#
# Default out_dir is ~/.racecor-diag/snapshots. The downloaded zip is
# named with a UTC timestamp so successive calls don't overwrite.

set -euo pipefail

host="${1:-}"
if [[ -z "$host" ]]; then
  echo "usage: $0 <host>[:port] [out_dir]" >&2
  exit 2
fi
if [[ "$host" != *:* ]]; then
  host="${host}:8891"
fi
out_dir="${2:-${HOME}/.racecor-diag/snapshots}"
mkdir -p "$out_dir"

ts=$(date -u +"%Y%m%d-%H%M%S")
target="${out_dir}/racecor-diag-${ts}.zip"

echo "fetching http://${host}/diag/snapshot  →  ${target}" >&2
http_status=$(curl -sS --max-time 60 -w "%{http_code}" -o "$target" "http://${host}/diag/snapshot")
if [[ "$http_status" != "200" ]]; then
  echo "error: server returned HTTP ${http_status}" >&2
  rm -f "$target"
  exit 1
fi

# Unzip alongside the archive so Claude can read individual files
# directly without an unzip step.
extract_dir="${target%.zip}"
mkdir -p "$extract_dir"
unzip -q -o "$target" -d "$extract_dir"
echo "extracted: ${extract_dir}" >&2

# Quick summary so a human eyeballing the output gets the gist.
files_count=$(find "$extract_dir" -type f | wc -l | tr -d ' ')
total_size=$(du -sh "$extract_dir" | awk '{print $1}')
echo "snapshot: ${files_count} files, ${total_size}" >&2
echo "$extract_dir"
