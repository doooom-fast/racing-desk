#!/bin/zsh
# Sponsor marks used by the design scripts. Death and Blood Incantation are in this folder
# already; these three are fetched rather than committed, since they are third-party marks.
set -e
cd "$(dirname "$0")"
UA="Mozilla/5.0 livery-tool/1.0"
curl -sL -A "$UA" "https://upload.wikimedia.org/wikipedia/commons/7/73/Liquid-Death-Logo-2026.png" -o liquiddeath.png
curl -sL -A "$UA" "https://upload.wikimedia.org/wikipedia/commons/a/a5/Sunn.png" -o sunn.png
curl -sL -A "$UA" "https://upload.wikimedia.org/wikipedia/commons/0/08/Cisco_logo_blue_2016.svg" -o cisco.svg
qlmanage -t -s 1600 -o . cisco.svg >/dev/null 2>&1 && mv cisco.svg.png cisco.svg.png 2>/dev/null || true
echo "fetched: liquiddeath.png sunn.png cisco.svg (+ cisco.svg.png via Quick Look)"
