# Collector — Setup

Dieser Ordner enthält das Node.js/Playwright-Skript, das alle 10 Minuten via GitHub Actions
deine ElevenLabs-Einnahmen ausliest und ins Google Sheet schreibt. Details/Architektur siehe
`../docs/superpowers/specs/2026-08-18-elevenlabs-earnings-automation-design.md`.

**Wichtig:** Der Collector schreibt in zwei NEUE Tabs (`Automatisiert`, `Status`) in deinem
bestehenden Sheet — deine bisherige, manuell gepflegte Tabelle `ab 2.2025` bleibt unangetastet.

## Einmalige Einrichtung (das musst du selbst tun — Login-Daten kann ich nicht für dich eingeben)

### 1. Lokal: Node-Abhängigkeiten installieren

```bash
cd collector
npm install
npx playwright install chromium
```

### 2. Lokal: Bei ElevenLabs einloggen und Session speichern

```bash
npm run login
```

Es öffnet sich ein Browser-Fenster. Logge dich normal bei ElevenLabs ein (inkl. eventueller
2FA), warte bis die Payouts-Seite mit "Current Period" sichtbar ist, dann im Terminal ENTER
drücken. Das Skript speichert `collector/storageState.json` (liegt in `.gitignore`, wird nie
committed).

### 3. Google-Cloud-Service-Account anlegen

1. https://console.cloud.google.com → neues Projekt (oder bestehendes nutzen).
2. "APIs & Services" → "Google Sheets API" aktivieren.
3. "IAM & Admin" → "Service Accounts" → neuen Service-Account anlegen.
4. Für diesen Account einen JSON-Key erzeugen und herunterladen.
5. Dein Google Sheet öffnen → "Teilen" → die E-Mail-Adresse des Service-Accounts
   (steht im JSON-Key, Feld `client_email`) mit **Bearbeiter-Zugriff** hinzufügen.

### 4. GitHub-Repository + Secrets

1. Dieses lokale Git-Repo auf GitHub pushen (privates Repo empfohlen).
2. Im GitHub-Repo: Settings → Secrets and variables → Actions → "New repository secret",
   dreimal:
   - `SPREADSHEET_ID` — die ID aus der Sheet-URL
     (`https://docs.google.com/spreadsheets/d/<DIESER-TEIL>/edit`)
   - `ELEVENLABS_STORAGE_STATE` — kompletter Inhalt von `collector/storageState.json`
     (als Text einfügen)
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — kompletter Inhalt des heruntergeladenen Service-Account-
     JSON-Keys

3. Fertig — der Workflow `.github/workflows/collect.yml` läuft danach automatisch alle
   10 Minuten. Manuell testen: GitHub-Repo → Tab "Actions" → "ElevenLabs Earnings Collector"
   → "Run workflow".

## Wenn die ElevenLabs-Session abläuft

Der Workflow schlägt fehl → GitHub schickt dir automatisch eine E-Mail. Dann einfach Schritt 2
(`npm run login`) wiederholen und das Secret `ELEVENLABS_STORAGE_STATE` aktualisieren.

## Lokal testen (ohne GitHub Actions)

```bash
export SPREADSHEET_ID="..."
export ELEVENLABS_STORAGE_STATE="$(cat storageState.json)"
export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat /pfad/zum/service-account-key.json)"
npm run collect
```
