# ElevenLabs Einnahmen — Automatisierung

Automatisiert die bisher manuell gepflegte Google-Sheets-Tabelle der ElevenLabs-Voice-Clone-
Einnahmen und stellt die Zahlen als lokales HTML-Dashboard und iOS-App (mit Home-Screen-
Widget) bereit.

**Vollständiges Konzept & alle Design-Entscheidungen:**
[`docs/superpowers/specs/2026-08-18-elevenlabs-earnings-automation-design.md`](docs/superpowers/specs/2026-08-18-elevenlabs-earnings-automation-design.md)

## Projektstruktur

| Ordner | Was |
|---|---|
| `collector/` | Node.js/Playwright-Skript, läuft alle 10 Min via GitHub Actions, liest ElevenLabs, schreibt ins Sheet |
| `apps-script/` | Google Apps Script Web App — liefert die Sheet-Daten als JSON |
| `html-dashboard/` | Lokale, eigenständige HTML-Datei (kein Build) für den Browser |
| `ios-app/` | SwiftUI-App + Home-Screen-Widget für dein iPhone |
| `.github/workflows/collect.yml` | Der Cron-Job, der den Collector alle 10 Min startet |

Alles ist geschrieben, geprüft (Syntax) und bereit. **Was jetzt noch fehlt, sind ausschließlich
Schritte, die zwingend dich selbst brauchen** (Logins, Klicks in deinem Google/GitHub/Apple-
Account) — die kann ich aus Sicherheits- und technischen Gründen nicht für dich übernehmen:

## Was du noch tun musst (einmalig)

1. **Collector einrichten** → [`collector/README.md`](collector/README.md)
   (bei ElevenLabs einloggen, Google-Service-Account anlegen, GitHub-Repo + Secrets)
2. **Datenbrücke deployen** → [`apps-script/README.md`](apps-script/README.md)
   (Apps Script an dein Sheet binden, als Web App bereitstellen, Token setzen)
3. **HTML-Dashboard konfigurieren**: in `html-dashboard/index.html` die Bridge-URL + Token
   eintragen (oben im `<script>`-Block), dann `./html-dashboard/start.sh` ausführen.
4. **iOS-App bauen** → [`ios-app/README.md`](ios-app/README.md)
   (Xcode-Projekt anlegen, Quelldateien einfügen, Bridge-URL eintragen, auf iPhone ausführen)

## Reihenfolge

Am besten in genau dieser Reihenfolge (1 → 4): Der Collector muss zuerst laufen und echte
Daten ins Sheet schreiben, bevor die Datenbrücke sinnvolle JSON-Antworten liefert — und erst
dann macht es Sinn, HTML-Dashboard und iOS-App gegen die Bridge zu testen.

## Bekannte, bewusst akzeptierte Grenzen

Siehe Design-Doku, Abschnitt "Bekannte Risiken / Limitationen" — u. a. GitHub-Actions-Cron-
Timing nicht exakt, iOS-Widget-Refresh nach Apple-Systembudget, FX-Kurs unabhängig von
ElevenLabs' eigener Umrechnung.
