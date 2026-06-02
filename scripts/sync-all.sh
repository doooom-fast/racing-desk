#!/usr/bin/env bash
#
# sync-all.sh — pull `main` on every prodrive repo and bump the shared agents submodule.
#
# Run from anywhere inside the prodrive-agents checkout:
#     scripts/sync-all.sh
# or point it at a workspace explicitly:
#     scripts/sync-all.sh /path/to/racecor-prodrive
#
# For each git repo sitting alongside prodrive-agents (everything under the
# racecor-prodrive/ workspace), it:
#   1. Forces the repo onto `main` with a plain `git checkout main`. If the
#      working tree is dirty in a way that blocks the switch, that repo is
#      reported and skipped — in-progress work is NEVER discarded.
#   2. Fast-forwards main: `git pull --ff-only`.
#   3. If the repo mounts prodrive-agents at `agents/`, advances the submodule
#      to the latest agents/main: `git submodule update --remote --init agents`.
#      The resulting pointer change is left UNSTAGED for you to review, commit,
#      and push — this script never commits or pushes for you.
#
# Repos with no agents/ submodule (prodrive-agents, homebridge, narrative) get
# steps 1–2 only. Non-git directories (e.g. prodrive-telemetry) are skipped.

{  # brace guard: parse the whole script before running, so a pull that updates
   # this file mid-execution cannot corrupt the run.

set -o pipefail

case "${1:-}" in
  -h|--help)
    cat <<'EOF'
sync-all.sh — pull main on every prodrive repo and bump the agents submodule.

Usage:
  scripts/sync-all.sh [WORKSPACE_DIR]

With no argument the workspace is auto-detected as the parent of the
prodrive-agents checkout this script lives in.

For each sibling git repo it: (1) checks out main (skips — never discards — if
the working tree is dirty), (2) git pull --ff-only, (3) if an agents/ submodule
exists, git submodule update --remote --init agents, leaving the pointer bump
unstaged for you to review, commit, and push.
EOF
    exit 0 ;;
esac

# ---- resolve the workspace (parent of the prodrive-agents checkout) --------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${1:-}" ]; then
  workspace="$(cd "$1" 2>/dev/null && pwd)" || { echo "no such directory: $1" >&2; exit 1; }
else
  agents_root="$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null)" \
    || { echo "not inside a git repo, and no workspace path was given" >&2; exit 1; }
  workspace="$(cd "$agents_root/.." && pwd)"
fi

# ---- colors (only when stdout is a tty) ------------------------------------
if [ -t 1 ]; then
  b=$(tput bold); red=$(tput setaf 1); grn=$(tput setaf 2)
  ylw=$(tput setaf 3); cyn=$(tput setaf 6); rst=$(tput sgr0)
else
  b=""; red=""; grn=""; ylw=""; cyn=""; rst=""
fi

printf "%sSyncing repos under%s %s\n\n" "$b" "$rst" "$workspace"

pulled=(); bumped=(); skipped=()

for dir in "$workspace"/*/; do
  repo="$(basename "$dir")"
  git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 || continue

  printf "%s%s== %s ==%s\n" "$b" "$cyn" "$repo" "$rst"
  branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

  # 1. force onto main, without discarding work (report git's real reason on failure)
  if [ "$branch" != "main" ]; then
    if out=$(git -C "$dir" checkout main 2>&1); then
      printf "  %sswitched%s %s -> main\n" "$grn" "$rst" "$branch"
    else
      reason=$(printf '%s\n' "$out" | grep -iE 'fatal|error' | head -1)
      printf "  %sskip%s (still on %s): %s\n" "$red" "$rst" "$branch" "${reason:-checkout main failed}"
      skipped+=("$repo — ${reason:-checkout main failed (was on $branch)}")
      printf "\n"; continue
    fi
  fi

  # 2. fast-forward main (report git's real reason on failure)
  if out=$(git -C "$dir" pull --ff-only 2>&1); then
    printf "  %spulled%s main\n" "$grn" "$rst"
    pulled+=("$repo")
  else
    reason=$(printf '%s\n' "$out" | grep -iE 'fatal|error' | head -1)
    printf "  %sskip%s: %s\n" "$red" "$rst" "${reason:-pull --ff-only failed}"
    skipped+=("$repo — ${reason:-pull --ff-only failed}")
    printf "\n"; continue
  fi

  # 3. bump agents submodule to latest agents/main, if present
  if [ -f "$dir/.gitmodules" ] && grep -qE 'path = agents$' "$dir/.gitmodules"; then
    if git -C "$dir" submodule update --remote --init agents >/dev/null 2>&1; then
      if git -C "$dir" diff --quiet -- agents; then
        printf "  agents already current\n"
      else
        sha="$(git -C "$dir/agents" rev-parse --short HEAD 2>/dev/null || echo '?')"
        printf "  %sbumped%s agents -> %s (pointer change unstaged)\n" "$ylw" "$rst" "$sha"
        bumped+=("$repo")
      fi
    else
      printf "  %swarn%s: agents submodule update failed\n" "$red" "$rst"
      skipped+=("$repo (agents update failed)")
    fi
  fi
  printf "\n"
done

# ---- summary ---------------------------------------------------------------
printf "%s-- summary --%s\n" "$b" "$rst"
printf "%spulled main:%s %d repo(s)\n" "$grn" "$rst" "${#pulled[@]}"
if [ "${#bumped[@]}" -gt 0 ]; then
  printf "%sagents bumped (review, then commit & push in each):%s\n" "$ylw" "$rst"
  for r in "${bumped[@]}"; do printf "   - %s\n" "$r"; done
  printf "   e.g.  git -C <repo> add agents && git -C <repo> commit -m 'bump agents' && git -C <repo> push\n"
else
  printf "agents: nothing to bump\n"
fi
if [ "${#skipped[@]}" -gt 0 ]; then
  printf "%sskipped/failed:%s\n" "$red" "$rst"
  for r in "${skipped[@]}"; do printf "   - %s\n" "$r"; done
fi

}
