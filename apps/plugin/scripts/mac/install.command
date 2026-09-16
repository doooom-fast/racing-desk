#!/bin/bash
# ═══════════════════════════════════════════════
#  K10 Motorsports — Install Dependencies
# ═══════════════════════════════════════════════

# Navigate to app root (K10 Motorsports/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/../../racecor-overlay"
cd "$APP_DIR"

echo "═══════════════════════════════════════════════"
echo " K10 Motorsports — Install Dependencies"
echo "═══════════════════════════════════════════════"
echo ""

# Check for npm
if ! command -v npm &>/dev/null; then
    echo "ERROR: npm not found."
    echo ""
    echo "Install Node.js from https://nodejs.org"
    echo "  or:  brew install node"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

echo "[1/7] Cleaning previous install (fixes code-signature issues)..."
rm -rf node_modules package-lock.json

echo ""
echo "[2/7] Installing Electron dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo ""
    echo "ERROR: npm install failed."
    read -p "Press Enter to close..."
    exit 1
fi

# Fix macOS code signature — required on Apple Silicon after fresh install
echo ""
echo "  Fixing Electron code signature..."
xattr -cr node_modules/electron/dist/Electron.app 2>/dev/null
codesign --force --deep --sign - node_modules/electron/dist/Electron.app 2>/dev/null

echo ""
echo "[3/5] Verifying dashboard..."
if [ -f "$APP_DIR/dashboard.html" ]; then
    echo "  dashboard.html OK"
else
    echo "  WARNING: dashboard.html not found"
fi

echo ""
echo "Done! Double-click 'K10 Motorsports.command' to launch the overlay."
echo ""
read -p "Press Enter to close..."
