#!/bin/bash
#
# One-time setup for local daily automation on macOS.
#
# Installs two launchd jobs for the current user:
#   com.newsagg.scrape  — runs the SeekingAlpha scrape once a day
#   com.newsagg.web     — keeps a local web server on http://localhost:8000
#
# Re-run this any time to update the schedule. Uninstall with uninstall_mac.sh.
#
# Usage:
#   bash newsagg/deploy/install_mac.sh            # daily at 09:00 local
#   bash newsagg/deploy/install_mac.sh 7          # daily at 07:00 local
#   PORT=8080 bash newsagg/deploy/install_mac.sh  # serve on a different port

set -euo pipefail

HOUR="${1:-9}"
PORT="${PORT:-8000}"

# Repo root = two levels up from this script (newsagg/deploy/ -> repo).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PY="$REPO_DIR/.venv/bin/python"

if [[ ! -x "$PY" ]]; then
  echo "ERROR: virtualenv python not found at $PY"
  echo "Create it first:  cd \"$REPO_DIR\" && python3 -m venv .venv && source .venv/bin/activate && pip install -r newsagg/requirements.txt"
  exit 1
fi

LA_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$REPO_DIR/data/newsagg/logs"
mkdir -p "$LA_DIR" "$LOG_DIR"

SCRAPE_PLIST="$LA_DIR/com.newsagg.scrape.plist"
HEAT_PLIST="$LA_DIR/com.newsagg.heat.plist"
WEB_PLIST="$LA_DIR/com.newsagg.web.plist"

echo "Repo:   $REPO_DIR"
echo "Python: $PY"
echo "Daily scrape at ${HOUR}:00 local; web server on http://localhost:${PORT}"

cat > "$SCRAPE_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.newsagg.scrape</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>-m</string>
    <string>newsagg.sa_scrape</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>$LOG_DIR/scrape.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/scrape.log</string>
</dict>
</plist>
EOF

cat > "$HEAT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.newsagg.heat</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>-m</string>
    <string>newsagg.heat</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>20</integer>
  </dict>
  <key>StandardOutPath</key><string>$LOG_DIR/heat.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/heat.log</string>
</dict>
</plist>
EOF

cat > "$WEB_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.newsagg.web</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>$REPO_DIR/newsagg/deploy/serve.py</string>
    <string>$PORT</string>
    <string>$REPO_DIR</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/web.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/web.log</string>
</dict>
</plist>
EOF

# Reload jobs (unload first if already installed; ignore errors).
for plist in "$SCRAPE_PLIST" "$HEAT_PLIST" "$WEB_PLIST"; do
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load -w "$plist"
done

echo
echo "✓ Installed. The web page is now always available at:"
echo "    http://localhost:${PORT}/newsagg/web/"
echo
echo "Run a scrape right now to populate it:"
echo "    launchctl start com.newsagg.scrape"
echo
echo "Logs:   $LOG_DIR/scrape.log   $LOG_DIR/web.log"
echo "Remove: bash newsagg/deploy/uninstall_mac.sh"
