#!/usr/bin/env bash
# Doppelklickbarer Starter fürs Dashboard - kein Terminal-Tippen nötig.
# macOS öffnet .command-Dateien per Doppelklick automatisch in Terminal.app
# und führt sie aus. Fenster schließt sich beim Beenden von selbst.
cd "$(dirname "$0")"
osascript -e 'tell application "Terminal" to close (every window whose name contains "Dashboard starten.command")' >/dev/null 2>&1 &
exec ./start.sh
