# Datenbrücke — Setup

`Code.gs` an dein Google Sheet binden und als Web App bereitstellen (das musst du selbst tun —
erfordert Klicks in deinem Google-Account):

1. Dein Sheet öffnen → Erweiterungen → Apps Script.
2. Den Inhalt von `Code.gs` einfügen (ersetzt den Standard-Code).
3. In Zeile `const ACCESS_TOKEN = "..."` ein eigenes, langes Zufalls-Token eintragen
   (z. B. mit `openssl rand -hex 16` erzeugen). Merke dir dieses Token — es kommt gleich
   ins HTML-Dashboard und in die iOS-App.
4. Oben rechts "Bereitstellen" → "Neue Bereitstellung" → Typ "Web App":
   - Ausführen als: "Ich" (dein Account)
   - Zugriff: "Jeder" (der Schutz erfolgt über das Token in der URL, siehe `Code.gs`)
5. Bereitstellen → die angezeigte Web-App-URL kopieren (endet auf `/exec`).
6. Test-Aufruf im Browser: `<deine-web-app-url>?token=<dein-token>` — sollte JSON liefern.

Diese URL (inkl. Token) wird von `html-dashboard/index.html` und der iOS-App verwendet.
