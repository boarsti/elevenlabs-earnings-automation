// Google-Sheets-Anbindung.
//
// WICHTIGE DESIGN-ENTSCHEIDUNG (autonom getroffen, siehe README):
// Der Collector schreibt NICHT in die bestehende, geschützte "ab 2.2025"-Tabelle
// (die bleibt unangetastet als dein manuelles Original-Archiv), sondern in DREI
// NEUE, eigene Tabs innerhalb derselben Spreadsheet-Datei:
//   - "Automatisiert":  ein Tagesdatensatz pro Zeile (Tages-Historie für Charts)
//   - "WeeklyHistory":  die VOLLSTÄNDIGE Wochen-Historie, 1:1 aus ElevenLabs'
//                       eigener "History"-Tabelle übernommen (reicht bis Feb 2025 zurück)
//   - "Status":         eine einzelne "Live-Snapshot"-Zeile (für die Bridge/App)
// So kann nichts an deiner bestehenden, geschützten Original-Tabelle kaputtgehen.

import { google } from "googleapis";

const DAILY_SHEET = "Automatisiert";
const WEEKLY_SHEET = "WeeklyHistory";
const STATUS_SHEET = "Status";
const INTRADAY_SHEET = "Intraday";

const DAILY_HEADERS = [
  "Datum",
  "Ablesezeit",
  "Anfangsguthaben_USD",
  "GesamtwertUSD",
  "TagesumsatzUSD",
  "WochenumsatzUSD",
  "DurchschnittUSD_Woche",
  "FXRate_USD_EUR",
  "WochenumsatzEUR_ElevenLabs",
  "WochenumsatzEUR_ueberFX",
  "RollierendeMonatssummeEUR",
  "AvgEUR_ProTag_Monat",
];

const WEEKLY_HEADERS = ["DatumZeit", "DatumIso", "BetragEUR", "Status"];

// Ein Datenpunkt pro Collector-Lauf (alle 10 Minuten), nur die letzten 48h werden
// behalten (siehe collect.js) - ermoeglicht eine echte Stunden-Kurve fuer "heute vs.
// gestern" im Dashboard, statt nur des einen Tages-Endwerts aus "Automatisiert".
const INTRADAY_HEADERS = ["Timestamp", "GesamtwertUSD"];

const STATUS_KEYS = [
  "readoutTimeWeekly",
  "weekStartBalanceUsd",
  "currentPeriodUsd",
  "currentPeriodCurrency",
  "allTimePayoutsEur",
  "lastUpdated",
  "stale",
  "historyRowCount",
];

export async function getAuthedSheets() {
  const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credsJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON ist nicht gesetzt (siehe README).");
  }
  const credentials = JSON.parse(credsJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

export async function ensureTabs(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set(meta.data.sheets.map((s) => s.properties.title));

  const toCreate = [DAILY_SHEET, WEEKLY_SHEET, STATUS_SHEET, INTRADAY_SHEET].filter(
    (t) => !existing.has(t)
  );
  if (toCreate.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })) },
    });
  }

  if (!existing.has(DAILY_SHEET)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${DAILY_SHEET}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [DAILY_HEADERS] },
    });
  }
  if (!existing.has(WEEKLY_SHEET)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${WEEKLY_SHEET}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [WEEKLY_HEADERS] },
    });
  }
  if (!existing.has(STATUS_SHEET)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${STATUS_SHEET}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [STATUS_KEYS] },
    });
  }
  if (!existing.has(INTRADAY_SHEET)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${INTRADAY_SHEET}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [INTRADAY_HEADERS] },
    });
  }
}

export async function readDailyRows(sheets, spreadsheetId) {
  return readRows(sheets, spreadsheetId, DAILY_SHEET, DAILY_HEADERS);
}

export async function readIntradayRows(sheets, spreadsheetId) {
  return readRows(sheets, spreadsheetId, INTRADAY_SHEET, INTRADAY_HEADERS);
}

export async function readWeeklyRows(sheets, spreadsheetId) {
  return readRows(sheets, spreadsheetId, WEEKLY_SHEET, WEEKLY_HEADERS);
}

async function readRows(sheets, spreadsheetId, sheetName, headers) {
  const lastCol = String.fromCharCode(64 + headers.length);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:${lastCol}100000`,
    // Bugfix (18.08.2026): ohne dies liefert die API den LOKAL-FORMATIERTEN Anzeigewert
    // ("87,18" mit Komma) statt der Rohzahl. Bei jedem Lauf, der bestehende Zeilen liest
    // und unveraendert zurueckschreibt (z.B. Intraday-Verlauf), kippten Zahlen dadurch
    // schleichend in Text um (Number("87,18") ist NaN) - betraf u.a. die Tag-Chart-Werte.
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values || [];
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

// Schreibt (oder überschreibt) eine Zeile anhand ihres Schlüssels in Spalte A.
// Hängt an, falls der Schlüssel noch nicht vorhanden ist.
export async function upsertRow(sheets, spreadsheetId, sheetName, headers, keyHeader, rowValuesByHeader) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:A100000`,
  });
  const keys = (res.data.values || []).map((r) => r[0]);
  const targetKey = rowValuesByHeader[keyHeader];
  const rowIndex = keys.indexOf(targetKey); // 0-basiert relativ zu Zeile 2

  const values = [headers.map((h) => rowValuesByHeader[h] ?? "")];

  if (rowIndex === -1) {
    // Bugfix (18.08.2026): Ein schmaler Range wie "A2" laesst die Sheets-API die
    // Tabellengrenzen falsch erkennen - neue Zeilen landeten dadurch direkt NACH der
    // Kopfzeile (Zeile 2) statt am tatsaechlichen Ende, wodurch aeltere Zeilen darunter
    // "verschoben" wirkten. Ein Range, der das ganze Blatt abdeckt, erkennt die
    // bestehende Tabelle zuverlaessig und haengt danach an.
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetName,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
  } else {
    const sheetRow = rowIndex + 2; // +1 fuer Header, +1 fuer 1-basierten Index
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  }
}

export async function upsertDailyRow(sheets, spreadsheetId, rowValuesByHeader) {
  return upsertRow(sheets, spreadsheetId, DAILY_SHEET, DAILY_HEADERS, "Datum", rowValuesByHeader);
}

// Ersetzt den gesamten Inhalt eines Tabs in EINEM API-Call (statt vieler einzelner
// Upserts). Wichtig fuer WeeklyHistory: ein Upsert pro Zeile (75+ Eintraege) hat
// live das Sheets-API-Ratenlimit gesprengt (429 "Quota exceeded"), siehe Design-Doku.
export async function replaceAllRows(sheets, spreadsheetId, sheetName, headers, rowsOfValuesByHeader) {
  const values = rowsOfValuesByHeader.map((row) => headers.map((h) => row[h] ?? ""));
  // Bugfix (18.08.2026): Leere Eingabe VOR dem Clear abfangen - sonst wuerde ein leeres
  // ElevenLabs-Ergebnis (z.B. durch ein kuenftig geaendertes Datumsformat, siehe
  // parseElevenLabsDate) den ganzen Tab loeschen, ohne etwas zurueckzuschreiben.
  if (!values.length) return;
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A2:${String.fromCharCode(64 + headers.length)}100000`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A2`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

// Batch-Variante fuer den einmaligen Backfill (schreibt viele Zeilen in einem API-Call
// statt vieler einzelner upserts - deutlich schneller und schont das API-Rate-Limit).
export async function appendRows(sheets, spreadsheetId, sheetName, headers, rowsOfValuesByHeader) {
  const values = rowsOfValuesByHeader.map((row) => headers.map((h) => row[h] ?? ""));
  if (!values.length) return;
  // Siehe Bugfix-Kommentar in upsertRow() - voller Sheet-Name statt schmalem "A2"-Range.
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

export async function readStatus(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${STATUS_SHEET}!A2:${String.fromCharCode(64 + STATUS_KEYS.length)}2`,
    valueRenderOption: "UNFORMATTED_VALUE", // siehe Bugfix-Kommentar in readRows()
  });
  const row = (res.data.values || [])[0] || [];
  return Object.fromEntries(STATUS_KEYS.map((k, i) => [k, row[i] ?? ""]));
}

export async function writeStatus(sheets, spreadsheetId, statusByKey) {
  const values = [STATUS_KEYS.map((k) => statusByKey[k] ?? "")];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${STATUS_SHEET}!A2`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

export {
  DAILY_HEADERS,
  WEEKLY_HEADERS,
  STATUS_KEYS,
  INTRADAY_HEADERS,
  DAILY_SHEET,
  WEEKLY_SHEET,
  STATUS_SHEET,
  INTRADAY_SHEET,
};
