#!/bin/zsh
# Re-extract each fleet car WITH its stock paint patterns. The patterns are the only reliable
# cue for which way a UV island faces: iRacing's own sponsor text on them reads correctly on the
# car, so whichever rotation makes that text readable is the rotation our art needs.
V=$1; S=$2; B=$3
for d in "$B/iracing-templates"/*/; do
  folder=$(basename "$d"); psd=$(ls "$d"*.psd 2>/dev/null | head -1)
  [ -z "$psd" ] && continue
  out="$B/fleet/$folder/work"
  ls "$out"/grp_Car_Patterns__*.png >/dev/null 2>&1 && { echo "$folder: patterns already there"; continue; }
  mkdir -p "$out"
  if $V "$S/template_extract.py" "$psd" --out "$out" --patterns >/dev/null 2>&1; then
    echo "$folder: $(ls "$out"/grp_Car_Patterns__*.png 2>/dev/null | wc -l | tr -d ' ') patterns"
  else
    echo "$folder: FAILED"
  fi
done
