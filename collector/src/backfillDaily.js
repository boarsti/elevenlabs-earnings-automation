// EINMALIGES Backfill-Skript (kein Teil des laufenden 10-Minuten-Workflows).
// Liest aus der bestehenden, manuell gepflegten Original-Tabelle "ab 2.2025"
// die Spalten A (Datum) und E (abgelesener Gesamtwert USD) ab Zeile 14 (29.04.2025,
// per Nutzerbestätigung der Startpunkt) und schreibt sie als Tages-Historie in die
// neue "Automatisiert"-Tabelle - damit das Dashboard von Anfang an zeigt, statt nur
// ab dem Tag, an dem die Automatisierung gestartet wurde.
//
// Schreibt NUR Datum + GesamtwertUSD (die für den Verlaufs-Chart relevanten Werte).
// Tages-/Wochenumsatz etc. werden für Bestandsdaten nicht rückwirkend rekonstruiert
// (die Original-Formeln nutzten in Teilen der Historie andere Konventionen, siehe
// Design-Doku "Verifizierte Sheet-Formeln") - für den Chart reicht der Rohwert.
//
// Aufruf (einmalig, lokal):
//   export SPREADSHEET_ID="..."
//   export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat /pfad/zum/service-account-key.json)"
//   node src/backfillDaily.js

import { google } from "googleapis";
import { getAuthedSheets, ensureTabs, DAILY_HEADERS, DAILY_SHEET } from "./sheetsClient.js";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SOURCE_SHEET = "ab 2.2025";
const START_ROW = 14; // 29.04.2025, siehe Nutzerbestätigung
const END_ROW = 489; // Zeile 490 = heute, wird bereits live vom Collector geschrieben

async function main() {
  if (!SPREADSHEET_ID) throw new Error("SPREADSHEET_ID ist nicht gesetzt.");

  const sheets = await getAuthedSheets();
  await ensureTabs(sheets, SPREADSHEET_ID);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SOURCE_SHEET}'!A${START_ROW}:E${END_ROW}`,
  });
  const rows = res.data.values || [];

  const backfillRows = [];
  for (const row of rows) {
    const [dateRaw, , , , eValue] = row;
    const iso = parseGermanSheetDate(dateRaw);
    if (!iso || eValue === undefined || eValue === "") continue;
    const usd = parseGermanNumber(eValue);
    if (usd === null) continue;
    backfillRows.push({ Datum: iso, GesamtwertUSD: usd });
  }

  console.log(`Gefunden: ${backfillRows.length} verwertbare Tageszeilen (von ${rows.length} Rohzeilen).`);

  // Bereits vorhandene Daten (z.B. durch mehrfaches Ausfuehren) nicht doppeln.
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${DAILY_SHEET}!A2:A100000`,
  });
  const existingDates = new Set((existing.data.values || []).map((r) => r[0]));
  const newRows = backfillRows.filter((r) => !existingDates.has(r.Datum));

  if (!newRows.length) {
    console.log("Keine neuen Zeilen - Backfill wurde vermutlich schon ausgefuehrt.");
    return;
  }

  const values = newRows.map((r) => DAILY_HEADERS.map((h) => r[h] ?? ""));
  // Bugfix (18.08.2026): voller Sheet-Name statt schmalem "A2"-Range, siehe
  // Bugfix-Kommentar in sheetsClient.js/upsertRow() - sonst landen neue Zeilen
  // direkt nach der Kopfzeile statt am Ende.
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: DAILY_SHEET,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  console.log(`OK: ${newRows.length} historische Tageszeilen in "${DAILY_SHEET}" ergaenzt.`);
}

// "Di. 29.04.25" -> "2025-04-29"
function parseGermanSheetDate(text) {
  if (!text) return null;
  const match = String(text).match(/(\d{1,2})\.(\d{1,2})\.(\d{2})/);
  if (!match) return null;
  const [, d, m, yy] = match;
  const year = 2000 + Number(yy);
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Deutsches Zahlenformat ("81,11" oder "81.11" oder "81") -> Number
function parseGermanNumber(text) {
  const cleaned = String(text).replace(",", ".").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

main().catch((err) => {
  console.error("Backfill fehlgeschlagen:", err);
  process.exit(1);
});
