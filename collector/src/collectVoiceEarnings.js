// Separater, 1x taeglicher Collector fuer die Pro-Stimme-Aufschluesselung (Nutzer-
// Anforderung 25.08.2026: "wieviele Credits die jeweiligen Stimmklone vermarktet
// haben"). Bewusst NICHT Teil von collect.js/collect.yml - eigener Workflow/Cron
// (siehe .github/workflows/collect-voice-earnings.yml, 21:15 UTC), damit ein
// Problem hier (neue, weniger erprobte UI-Automatisierung) nicht den kritischen
// alle-15-Minuten-Lauf der Kernzahlen gefaehrden kann. Nutzt dieselben Secrets wie
// der Haupt-Collector (SPREADSHEET_ID, ELEVENLABS_STORAGE_STATE,
// GOOGLE_SERVICE_ACCOUNT_JSON) - keine neuen Secrets noetig.

import { chromium } from "playwright";
import { readVoiceEarnings } from "./voiceEarningsReader.js";
import {
  getAuthedSheets,
  ensureVoiceEarningsTab,
  readVoiceEarningsRows,
  replaceAllRows,
  VOICE_EARNINGS_SHEET,
  VOICE_EARNINGS_HEADERS,
} from "./sheetsClient.js";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const STORAGE_STATE_JSON = process.env.ELEVENLABS_STORAGE_STATE;
// "30d" (Standard, taeglicher Cron-Lauf) oder "3y" (einmaliges Backfill der kompletten
// bisher verfuegbaren Kontohistorie - Nutzer-Anforderung 25.08.2026: "es fehlen aber
// eine Menge Monate. hole nach"). Wird ueber den workflow_dispatch-Input "range" in
// .github/workflows/collect-voice-earnings.yml gesetzt, Default bleibt "30d".
const RANGE = process.env.VOICE_EARNINGS_RANGE || "30d";

async function main() {
  if (!SPREADSHEET_ID) throw new Error("SPREADSHEET_ID ist nicht gesetzt.");
  if (!STORAGE_STATE_JSON) throw new Error("ELEVENLABS_STORAGE_STATE ist nicht gesetzt.");

  const sheets = await getAuthedSheets();
  await ensureVoiceEarningsTab(sheets, SPREADSHEET_ID);

  const storageState = JSON.parse(STORAGE_STATE_JSON);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState, timezoneId: "Europe/Berlin" });
  const page = await context.newPage();

  let fresh;
  try {
    fresh = await readVoiceEarnings(page, { range: RANGE });
  } finally {
    await browser.close();
  }

  // Bestehende Historie + frisches 30-Tage-Fenster mergen (Datum+VoiceId als Schluessel,
  // neue Werte gewinnen bei Ueberschneidung - ElevenLabs kann juengste Tage nachtraeglich
  // noch leicht korrigieren) und den ganzen Tab in EINEM API-Call neu schreiben (gleiches
  // Muster wie WeeklyHistory in sheetsClient.js - schont das Sheets-Ratenlimit).
  const existing = await readVoiceEarningsRows(sheets, SPREADSHEET_ID);
  const merged = new Map();
  existing.forEach((r) => {
    if (!r.Datum || !r.VoiceId) return;
    merged.set(`${r.Datum}|${r.VoiceId}`, r);
  });
  fresh.forEach((r) => {
    merged.set(`${r.date}|${r.voiceId}`, {
      Datum: r.date,
      VoiceId: r.voiceId,
      Stimme: r.voiceName,
      USD: r.Earnings,
      Characters: r.Characters,
    });
  });

  const rows = [...merged.values()].sort((a, b) => {
    if (a.Datum !== b.Datum) return a.Datum < b.Datum ? -1 : 1;
    return String(a.Stimme).localeCompare(String(b.Stimme));
  });

  await replaceAllRows(sheets, SPREADSHEET_ID, VOICE_EARNINGS_SHEET, VOICE_EARNINGS_HEADERS, rows);

  console.log(
    `OK: ${rows.length} Zeilen in "${VOICE_EARNINGS_SHEET}" (frisch abgerufen: ${fresh.length}, Bestand zuvor: ${existing.length})`
  );
}

main().catch((err) => {
  console.error("Voice-Earnings-Collector fehlgeschlagen:", err);
  process.exit(1); // GitHub Actions markiert den Run als failed -> eigene Fehler-Mail
});
