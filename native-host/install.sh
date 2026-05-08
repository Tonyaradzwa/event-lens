#!/bin/bash
# Installs the Event Lens native messaging host on this Mac.
# Usage: ./install.sh <chrome-extension-id>
#
# Find the extension ID at chrome://extensions (enable Developer mode).
# Example: ./install.sh abcdefghijklmnopabcdefghijklmnop

set -e

EXT_ID="${1:-}"
if [ -z "$EXT_ID" ]; then
  echo "Usage: ./install.sh <chrome-extension-id>"
  echo ""
  echo "Find your extension ID at chrome://extensions (toggle Developer mode on)."
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  echo "Error: python3 not found."
  echo "Install it by running: xcode-select --install"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.event-lens"
HOST_PATH="$INSTALL_DIR/host.py"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/com.eventlens.calendar.json"

mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/host.py" "$HOST_PATH"
chmod +x "$HOST_PATH"

mkdir -p "$MANIFEST_DIR"
cat > "$MANIFEST_PATH" <<EOF
{
  "name": "com.eventlens.calendar",
  "description": "Event Lens Calendar Helper",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

echo ""
echo "Done! Native helper installed."
echo "  Host:     $HOST_PATH"
echo "  Manifest: $MANIFEST_PATH"
echo ""
echo "Reload the Event Lens extension in Chrome, then test it on an email."
