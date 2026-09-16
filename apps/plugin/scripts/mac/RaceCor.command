#!/bin/bash
# ═══════════════════════════════════════════════
#  K10 Motorsports — Overlay Launcher (macOS)
# ═══════════════════════════════════════════════

# Navigate to the Electron app root (racecor-overlay/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/../../racecor-overlay"
cd "$APP_DIR"

echo "═══════════════════════════════════════════════"
echo " K10 Motorsports — Starting Overlay"
echo "═══════════════════════════════════════════════"
echo ""
echo "Hotkeys:"
echo "  Cmd+Shift+S   Toggle settings mode (clickable)"
echo "  Cmd+Shift+H   Toggle overlay visibility"
echo "  Cmd+Shift+G   Toggle green-screen mode (restarts)"
echo "  Cmd+Shift+R   Reset window position/size"
echo "  Cmd+Shift+D   Restart demo sequence"
echo "  Cmd+Shift+M   Reset track map"
echo "  Cmd+Shift+Q   Quit overlay"
echo ""

# Check for npm/npx
if ! command -v npx &>/dev/null; then
    echo "ERROR: Node.js not found."
    echo ""
    echo "Install it from https://nodejs.org"
    echo "  or:  brew install node"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

# Auto-install if node_modules missing or Electron binary not executable
if [ ! -d "node_modules" ] || [ ! -x "node_modules/.bin/electron" ]; then
    echo "Installing dependencies..."
    echo ""
    bash "$SCRIPT_DIR/install.command"
    if [ $? -ne 0 ]; then
        read -p "Press Enter to close..."
        exit 1
    fi
    echo ""
    echo "Dependencies installed. Launching overlay..."
    echo ""
fi

# Ensure all bin stubs are executable (may lose +x via cross-platform sync)
chmod +x node_modules/.bin/* 2>/dev/null

# Fix Electron code signature if needed (macOS kills unsigned binaries on Apple Silicon)
ELECTRON_APP="node_modules/electron/dist/Electron.app"
if [ -d "$ELECTRON_APP" ]; then
    codesign --verify "$ELECTRON_APP" 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "Fixing Electron code signature..."
        xattr -cr "$ELECTRON_APP" 2>/dev/null
        codesign --force --deep --sign - "$ELECTRON_APP" 2>/dev/null
    fi
fi

# Launch Electron overlay (detach so Terminal can close)
nohup npx electron . >/dev/null 2>&1 &
disown
