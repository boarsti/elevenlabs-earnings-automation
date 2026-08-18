#!/usr/bin/env bash
# Startet einen winzigen lokalen Webserver für dieses Dashboard (kein npm, kein Build)
# und öffnet es im Standardbrowser. Hintergrund: eine per Doppelklick geöffnete
# file://-Datei darf aus Sicherheitsgründen oft keine externen JSON-Requests machen.
cd "$(dirname "$0")"
PORT=8842
open "http://localhost:${PORT}" 2>/dev/null || true
python3 -m http.server "$PORT"
