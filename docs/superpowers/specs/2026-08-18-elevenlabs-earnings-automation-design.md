# ElevenLabs Einnahmen-Automatisierung — Design

## Kontext & Ziel

Der Nutzer pflegt seit Februar 2025 stündlich/täglich von Hand ein Google Sheet ("Elevenlabs Einnahmen"), das seine ElevenLabs-Voice-Clone-Auszahlungen trackt (Spalten A–M: Datum, Auszahlungszeit, Anfangsguthaben, Tages-/Wochenwerte, Ø-Werte, FX-Faktor, EUR-Umrechnung, Monatswerte). Das soll automatisiert werden. Zusätzlich gewünscht:

- Eine **iOS-App** (iPhone 16 Pro) mit Home-Screen-Widget: statisch die wöchentliche Ablese-Uhrzeit, darunter der $-Wert seit "gestern dieser Uhrzeit". Beim Öffnen: aufbereitetes Dashboard (keine Tabelle).
- Eine **lokale HTML-Datei**, die alle 10 Minuten selbstständig aktuelle Daten zieht, im Browser des Nutzers.
- Zusätzliche, im Gespräch bestätigte Anforderung: **die volle Historie soll in Stufen (Tag/Woche/Monat) sichtbar sein**, angelehnt an die vorhandene Sheet-Kurve.

Verfügbare Ressourcen: ElevenLabs-Account (Login), Google-Account.

## Research-Befunde (bestimmen die Architektur)

Per Live-Untersuchung der ElevenLabs-Weboberfläche (authentifizierte Session, Netzwerk-/JS-Bundle-Analyse) wurde festgestellt:

1. **Es gibt keine offizielle, dokumentierte Payout-/Earnings-API.** Die öffentliche ElevenLabs-API bietet nur `GET /v1/usage/character-stats` (eigener Verbrauch als Konsument), nicht die Einnahmen aus geteilten Voice-Clones.
2. Die Payouts-Seite (`/app/voices-earnings/payouts`) zeigt exakt die Werte, die der Nutzer bisher manuell abliest ("Current Period" in USD, "All Time Payouts" in EUR, History-Tabelle mit Date/Amount/Currency/Status). Kein CSV-Export, nur der Button "Sync with Stripe".
3. Diese Werte werden **rein client-seitig über einen Google-Firestore-Realtime-Listener** geladen (Projekt `xi-labs`, Firebase Auth). Es existiert kein REST-GET-Endpunkt und keine SSR-Einbettung der Werte im initialen HTML (verifiziert). Das Firestore-Wire-Protokoll (WebChannel) ist mit den verfügbaren Mitteln nicht praktikabel zu dekodieren (bräuchte Skript-Injektion vor App-Bootstrap, nicht verfügbar).
4. Entscheidung (mit Nutzer abgestimmt): **Die Zahlen werden von der authentifizierten, gerenderten Seite gelesen** (stabile Text-Labels: "Current Period", "All Time Payouts", Tabellen-Header), nicht per Firestore-Direktzugriff. Das ist pragmatisch gleich robust, da beide Wege auf undokumentierten, änderbaren Interna beruhen — der Geschwindigkeitsvorteil von Firestore ist bei einem 10-Minuten-Intervall irrelevant.

## Architektur

```
[Collector: Playwright, GitHub Actions, alle 10 Min]
        │  liest authentifiziert die Payouts-Seite,
        │  schreibt Zeile via Sheets-API (Service Account)
        ▼
[Google Sheet — bleibt "Datenbank", volle Historie]
        │  gelesen von
        ▼
[Google Apps Script Web App — liefert JSON via HTTP GET]
        │                              │
        ▼                              ▼
[Lokales HTML-Dashboard]        [iOS App + Widget]
 (pollt alle 10 Min)             (Widget: System-Budget-Refresh;
                                  App: Pull-to-Refresh)
```

Drei unabhängig austauschbare Bausteine: **Collector** (Datenbeschaffung), **Brücke** (Sheet + Web-App), **Clients** (HTML + iOS). Ändert sich ElevenLabs' UI, wird nur der Collector angepasst.

## Komponenten

### 1. Collector (Playwright, Node.js, läuft auf GitHub Actions)

- Einmaliger, interaktiver Login-Lauf (lokal, vom Nutzer ausgeführt) speichert Playwright `storageState` (Cookies + LocalStorage inkl. Firebase-Auth) — verschlüsselt/als GitHub Secret hinterlegt, **niemals im Klartext committed**.
- Scheduled GitHub Actions Workflow (Cron, Zielintervall 10 Minuten — GitHub garantiert keine exakte Taktung, Verzögerungen von einigen Minuten sind bei Cron-Workflows möglich und werden als Limitation akzeptiert):
  1. Headless-Browser mit gespeicherter Session startet, öffnet `/app/voices-earnings/payouts`.
  2. Wartet auf Hydration, liest "Current Period" ($), "All Time Payouts" (€), History-Tabellen-Zeilen (Date/Amount/Currency/Status) über Text-Anker (keine fragilen CSS-Klassen).
  3. Berechnet abgeleitete Werte analog zum bestehenden Sheet (Tagesumsatz, kumulierter Wochenumsatz, Ø, Monatswerte, FX via unabhängiger FX-API — siehe Risiken).
  4. Schreibt/aktualisiert eine Zeile im Google Sheet via Sheets API (Google-Cloud-Service-Account, eigens für dieses Projekt angelegt, per GitHub Secret).
- **Fehlerfall** (Login abgelaufen, UI-Element nicht gefunden): Workflow schlägt fehl → GitHub sendet automatisch eine Fehler-Mail an den Repo-Owner. Kein stiller Ausfall.

### 2. Datenbrücke (Google Apps Script Web App)

- An das Sheet gebundenes Apps Script, deployed als Web App (`Anyone with the link` + einfacher Token-Query-Parameter als Zugriffsschutz).
- `GET /exec?token=...` liefert JSON:
  ```json
  {
    "readoutTimeWeekly": "18:50",
    "sinceReadoutUsd": 76.82,
    "allTimePayoutsEur": 19133.13,
    "currentPeriodUsd": 76.82,
    "lastUpdated": "2026-08-18T14:30:00Z",
    "stale": false,
    "history": {
      "daily": [ { "date": "2026-08-17", "usd": 145.2 }, ... ],
      "weekly": [ { "weekStart": "2026-08-10", "eur": 217.07 }, ... ],
      "monthly": [ { "month": "2026-08", "usd": 3120.5, "avgUsd": 100.7 }, ... ]
    }
  }
  ```
- `stale: true`, wenn `lastUpdated` älter als 30 Minuten ist — Clients zeigen dann "Daten veraltet" statt falscher Aktualität an.

### 3. Lokales HTML-Dashboard

- Eine Datei, kein Build-Schritt: Tailwind CSS + Chart.js jeweils per CDN, Vanilla JS.
- Pollt die Bridge-URL alle 10 Minuten (`setInterval` + `fetch`).
- Oben: die zwei Kernwerte groß (Ablese-Uhrzeit, Wert seit "gestern dieser Uhrzeit"). Darunter: KPI-Karten (Current Period, All-Time, Woche, Monat) + Verlaufs-Chart mit Umschalter Tag/Woche/Monat + Tabelle der letzten Auszahlungen.
- Design angelehnt an die vom Nutzer verlinkten Vorlagen (Karten-Layout, Dark Mode, Chart-Stil), aber als eigenständige statische Datei statt Next.js/Nuxt-Projekt (passt zum Wunsch "lokale HTML ohne Build").
- Hinweis: Ein per Doppelklick geöffnetes `file://`-Dokument kann u. U. keine Cross-Origin-Requests stellen; ausgeliefert wird zusätzlich ein 1-Zeilen-Start-Skript für einen lokalen Mini-Webserver (kein npm, kein Build).

### 4. iOS App (SwiftUI)

- **Home-Screen-Widget** (WidgetKit, klein/mittel): oben statische Wochen-Ablesezeit, unten $-Wert seit "gestern dieser Uhrzeit" — farbig, modernes Karten-Design. Realistische Aktualisierungsrate: System-Budget (~15–70 Min), kein echtzeitnahes Push-Update in v1.
- **App-Ansicht**: Dashboard mit KPI-Karten + Verlaufs-Chart (Swift Charts, nativ) mit Zeitraum-Umschalter — spiegelt das HTML-Dashboard.
- Datenquelle: ausschließlich die JSON-Bridge (kein direkter ElevenLabs- oder Google-Zugriff auf dem Gerät).
- Distribution: Xcode + eigenes Gerät (kostenlos), App muss alle 7 Tage neu signiert werden (Apple-Limit ohne Entwickler-Programm) — akzeptierter wiederkehrender manueller Schritt.

## Sicherheit

- ElevenLabs-Session-State und Google-Service-Account-Key ausschließlich als **GitHub Secrets**, nie im Repo.
- Bridge-Zugriff durch einfaches Token geschützt (kein sensibler Finanzzugang dahinter, nur aggregierte eigene Zahlen — Bedrohungsmodell: Zufallszugriff verhindern, nicht gezielten Angriff).
- Kein Klartext-Passwort in jeglichem Skript.

## Bekannte Risiken / Limitationen

- **FX-Umrechnung**: Der Collector nutzt eine unabhängige FX-API; kann geringfügig vom internen ElevenLabs-Kurs (Spalte J) abweichen. Wird transparent gekennzeichnet, nicht verschwiegen.
- **Auszahlungs-Zeitpunkt driftet**: ElevenLabs zahlt laut eigener Doku "alle 6–8 Tage", nicht exakt wöchentlich fix. Die "statische Wochen-Uhrzeit" wird pro Woche neu aus dem tatsächlichen Auszahlungs-Zeitstempel bestimmt, nicht hart codiert.
- **GitHub-Actions-Cron-Timing**: Kein Echtzeit-Garant; Verzögerungen von einigen Minuten sind normal.
- **UI-Änderungen bei ElevenLabs**: Der Collector kann brechen, wenn ElevenLabs Text-Labels/Struktur der Payouts-Seite ändert. Mitigation: Fehler-Alarmierung statt stiller Ausfall (siehe oben).
- **iOS-Widget-Aktualität**: kein garantiertes 10-Minuten-Live-Update, siehe Komponente 4.

## Offene Punkte für die Umsetzungsphase (nicht Teil dieses Designs)

- Exakte Nachbildung der bestehenden Sheet-Formeln (Spalten F–M) — wird beim Einlesen des Live-Sheets in der Implementierung 1:1 übernommen.
- Einrichtung Google-Cloud-Service-Account + Sheets-API-Freigabe.
- Einrichtung GitHub-Repo (Remote) + Secrets.
- Backfill-Strategie für historische Daten (bestehende Sheet-Historie wird übernommen, nicht neu berechnet).
- Playwright-Login-Flow (Umgang mit ggf. 2FA — einmaliger interaktiver Schritt, kein Automatisierungsproblem für den laufenden Betrieb).
