#!/bin/zsh
# Run an ExtendScript in Photoshop, passing key=value params as a global P object.
#   ps_run.sh ps_build.jsx template="/path/Car.psd" art="/path/art_uv_rgba.png" out="/path/out/"
# The script text is sent inline (Photoshop cannot read files under the sandbox /private/tmp),
# and the AppleEvent timeout is raised so long exports don't report a false failure.
set -e
script="$1"; shift
json="{"; sep=""
for kv in "$@"; do k="${kv%%=*}"; v="${kv#*=}"; v="${v//\\/\\\\}"; v="${v//\"/\\\"}"; json+="$sep\"$k\":\"$v\""; sep=","; done
json+="}"
JS="var P=$json;
$(cat "$script")"
APP="${PS_APP:-Adobe Photoshop 2026}"
osascript - "$JS" <<OSA
on run argv
  with timeout of 1800 seconds
    tell application "$APP" to do javascript (item 1 of argv)
  end timeout
end run
OSA
