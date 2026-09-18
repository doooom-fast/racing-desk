#!/usr/bin/env bash
# Print the commands to lift prodrive-livery/ out of prodrive-agents into its own
# repo, keeping the history of these files. Prints only — nothing here runs.
set -euo pipefail

cat <<'INSTRUCTIONS'
# From a clone of prodrive-agents:

git subtree split --prefix=prodrive-livery -b livery-only

# Create k10-motorsports/prodrive-livery on GitHub (empty), then:

git clone --no-hardlinks . /tmp/prodrive-livery
cd /tmp/prodrive-livery
git checkout livery-only
git branch -D main 2>/dev/null || true
git branch -m main
git remote set-url origin git@github.com:k10-motorsports/prodrive-livery.git
git push -u origin main

# Back in prodrive-agents, drop the staged copy:
git rm -r prodrive-livery
git commit -m "chore: prodrive-livery moved to its own repo"

# The agent skill stays in prodrive-agents (skills/livery-pipeline/) and points at
# the new repo — update the path in its SKILL.md if the checkout lives elsewhere.
INSTRUCTIONS
