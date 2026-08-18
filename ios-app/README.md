# iOS App — Setup

Hier liegt der komplette Swift-Quellcode für App + Home-Screen-Widget. Eine .xcodeproj-Datei
lege ich bewusst **nicht** von Hand an (dieses Format ist fehleranfällig ohne Xcode selbst) —
das folgende Setup dauert ca. 10 Minuten und muss einmalig von dir in Xcode gemacht werden
(braucht deine Apple-ID/dein Gerät, das kann ich nicht für dich tun):

## 1. Neues Xcode-Projekt anlegen

1. Xcode → File → New → Project → **App**
2. Name: `ElevenLabsEarnings`, Interface: **SwiftUI**, Language: **Swift**
3. Speicherort: dieser `ios-app`-Ordner (Xcode legt dann automatisch einen
   `ElevenLabsEarnings.xcodeproj` an)

## 2. Die Quelldateien einfügen

Im Finder die Dateien aus `ios-app/ElevenLabsEarnings/` per Drag & Drop in die Xcode-
Projektnavigation ziehen (in die Gruppe `ElevenLabsEarnings`), dabei **"Copy items if
needed"** NICHT nötig (liegen schon im Projektordner), aber **Target: ElevenLabsEarnings**
ankreuzen. Die von Xcode automatisch erzeugte `ContentView.swift`/`...App.swift` kannst du
löschen (durch die mitgelieferten Dateien ersetzt).

## 3. Widget-Extension-Target hinzufügen

1. File → New → Target → **Widget Extension**
2. Name: `ElevenLabsEarningsWidget`, **"Include Live Activity" abwählen**
3. Die von Xcode generierten Platzhalter-Dateien im neuen Target-Ordner löschen, stattdessen
   die Dateien aus `ios-app/ElevenLabsEarningsWidget/` per Drag & Drop einfügen, Target:
   **ElevenLabsEarningsWidget**

## 4. Config.swift, EarningsData.swift, EarningsClient.swift in BEIDEN Targets

Diese drei Dateien werden von App **und** Widget gebraucht. Datei anklicken → rechts im
"File Inspector" unter "Target Membership" **beide** Häkchen setzen (App + Widget).

## 5. Bridge-URL eintragen

In `ElevenLabsEarnings/Config.swift` die Web-App-URL + Token aus
`apps-script/README.md` eintragen.

## 6. Auf eigenem iPhone ausführen

1. iPhone per Kabel verbinden, in Xcode als Ziel-Gerät auswählen.
2. Signing & Capabilities → dein Apple-ID-Team auswählen (kostenloses Personal Team reicht).
3. ▶ Run.
4. Auf dem iPhone: Einstellungen → Allgemein → VPN & Geräteverwaltung → deinem
   Entwickler-Profil vertrauen (einmalig).
5. Widget hinzufügen: Home-Bildschirm gedrückt halten → "+" → "ElevenLabsEarnings" suchen.

**Hinweis:** Ohne kostenpflichtiges Apple Developer Program läuft die App 7 Tage, danach in
Xcode erneut "Run" drücken (siehe Design-Doku, akzeptierte Limitation).
