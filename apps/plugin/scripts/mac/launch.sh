#!/bin/bash
# RaceCor — Silent Launcher
# Runs the Electron overlay without keeping a terminal window open.

# Navigate to app root (racecor-overlay/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/../../racecor-overlay"
cd "$APP_DIR"

# Auto-install if needed
if [ ! -d "node_modules" ] || [ ! -x "node_modules/.bin/electron" ]; then
    rm -rf node_modules package-lock.json
    npm install 2>&1 | tail -5
fi


chmod +x node_modules/.bin/* 2>/dev/null

# Fix Electron code signature if needed (macOS Apple Silicon)
ELECTRON_APP="node_modules/electron/dist/Electron.app"
if [ -d "$ELECTRON_APP" ]; then
    codesign --verify "$ELECTRON_APP" 2>/dev/null
    if [ $? -ne 0 ]; then
        xattr -cr "$ELECTRON_APP" 2>/dev/null
        codesign --force --deep --sign - "$ELECTRON_APP" 2>/dev/null
    fi
fi

# Launch Electron (nohup + disown to fully detach)
nohup npx electron . >/dev/null 2>&1 &
disown
