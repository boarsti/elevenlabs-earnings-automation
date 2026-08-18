// Google-Sheets-Anbindung.
//
// WICHTIGE DESIGN-ENTSCHEIDUNG (autonom getroffen, siehe README):
// Der Collector schreibt NICHT in die bestehende, geschützte "ab 2.2025"-Tabelle
// (die bleibt unangetastet als dein manuelles Original-Archiv), sondern in zwei
// NEUE, eigene Tabs innerhalb derselben Spreadsheet-Datei:
//   - "Automatisiert": ein Tagesdatensatz pro Zeile (Historie für Charts)
//   - "Status":         eine einzelne "Live-Snapshot"-Zeile (für die Bridge/App)
// So kann nichts an deiner bestehenden, geschützten Original-Tabelle kaputtgehen.

import { google } from "googleapis";

const DAILY_SHEET = "Automatisiert";
const STATUS_SHEET = "Status";

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

  const requests = [];
  if (!existing.has(DAILY_SHEET)) {
    requests.push({ addSheet: { properties: { title: DAILY_SHEET } } });
  }
  if (!existing.has(STATUS_SHEET)) {
    requests.push({ addSheet: { properties: { title: STATUS_SHEET } } });
  }
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }

  if (!existing.has(DAILY_SHEET)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${DAILY_SHEET}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [DAILY_HEADERS] },
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
}

export async function readDailyRows(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${DAILY_SHEET}!A2:M100000`,
  });
  const rows = res.data.values || [];
  return rows.map((r) => Object.fromEntries(DAILY_HEADERS.map((h, i) => [h, r[i] ?? ""])));
}

// Schreibt (oder überschreibt) die Zeile für ein gegebenes Datum (YYYY-MM-DD).
// Sucht die Zeile anhand von Spalte A; hängt an, falls Datum noch nicht vorhanden.
export async function upsertDailyRow(sheets, spreadsheetId, rowValuesByHeader) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${DAILY_SHEET}!A2:A100000`,
  });
  const dates = (res.data.values || []).map((r) => r[0]);
  const targetDate = rowValuesByHeader["Datum"];
  const rowIndex = dates.indexOf(targetDate); // 0-basiert relativ zu A2

  const values = [DAILY_HEADERS.map((h) => rowValuesByHeader[h] ?? "")];

  if (rowIndex === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${DAILY_SHEET}!A2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
  } else {
    const sheetRow = rowIndex + 2; // +1 fuer Header, +1 fuer 1-basierten Index
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${DAILY_SHEET}!A${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  }
}

export async function readStatus(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${STATUS_SHEET}!A2:${String.fromCharCode(64 + STATUS_KEYS.length)}2`,
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

export { DAILY_HEADERS, STATUS_KEYS, DAILY_SHEET, STATUS_SHEET };
