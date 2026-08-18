// Haupt-Collector. Läuft alle 10 Minuten via GitHub Actions (siehe
// .github/workflows/collect.yml). Liest ElevenLabs, berechnet die abgeleiteten
// Werte nach der verifizierten Sheet-Logik (siehe Design-Doku) und schreibt:
//   - "Automatisiert": höchstens EINE Zeile pro Kalendertag (Upsert)
//   - "Status":         Live-Snapshot bei JEDEM Lauf (für die App-Bridge)

import { chromium } from "playwright";
import { readEarnings } from "./elevenlabsReader.js";
import { getUsdToEurRate } from "./fx.js";
import {
  getAuthedSheets,
  ensureTabs,
  readDailyRows,
  upsertDailyRow,
  readStatus,
  writeStatus,
} from "./sheetsClient.js";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const STORAGE_STATE_JSON = process.env.ELEVENLABS_STORAGE_STATE;

async function main() {
  if (!SPREADSHEET_ID) throw new Error("SPREADSHEET_ID ist nicht gesetzt.");
  if (!STORAGE_STATE_JSON) throw new Error("ELEVENLABS_STORAGE_STATE ist nicht gesetzt.");

  const sheets = await getAuthedSheets();
  await ensureTabs(sheets, SPREADSHEET_ID);

  const storageState = JSON.parse(STORAGE_STATE_JSON);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  let earnings;
  try {
    earnings = await readEarnings(page);
  } finally {
    await browser.close();
  }

  const fxRate = await getUsdToEurRate();
  const today = isoDate(new Date());

  const dailyRows = await readDailyRows(sheets, SPREADSHEET_ID);
  const sortedRows = [...dailyRows].sort((a, b) => (a.Datum < b.Datum ? -1 : 1));

  // "Neue Woche"-Erkennung: History-Zeilenanzahl hat sich seit dem letzten Lauf erhöht
  // (der vorherige "Pending"-Eintrag wurde final "Paid", ein neuer "Pending"-Eintrag kam hinzu).
  const previousStatus = await readStatus(sheets, SPREADSHEET_ID);
  const lastKnownCount = Number(previousStatus.historyRowCount || 0);
  const currentCount = earnings.history.length;
  const isNewWeek = lastKnownCount === 0 || currentCount > lastKnownCount;

  const weekAnchorRow = isNewWeek
    ? null
    : [...sortedRows].reverse().find((r) => r.Anfangsguthaben_USD !== "");

  const weekStartBalance = isNewWeek
    ? earnings.currentPeriod.amount
    : Number(weekAnchorRow?.Anfangsguthaben_USD ?? earnings.currentPeriod.amount);

  const weekAnchorDate = isNewWeek ? today : weekAnchorRow?.Datum ?? today;
  const daysElapsedThisWeek = Math.max(1, daysBetween(weekAnchorDate, today) + 1);

  const yesterdayRow = [...sortedRows].reverse().find((r) => r.Datum < today);
  const previousE = yesterdayRow ? Number(yesterdayRow.GesamtwertUSD) : weekStartBalance;

  const gesamtwertUsd = earnings.currentPeriod.amount;
  const tagesumsatzUsd = isNewWeek ? gesamtwertUsd - weekStartBalance : gesamtwertUsd - previousE;
  const wochenumsatzUsd = gesamtwertUsd - weekStartBalance;
  const durchschnittUsd = wochenumsatzUsd / daysElapsedThisWeek;

  const latestHistoryEntry = earnings.history[earnings.history.length - 1];
  const wochenumsatzEurElevenLabs = latestHistoryEntry?.amount ?? "";
  const wochenumsatzEurUeberFx = wochenumsatzUsd * fxRate;

  const rollierendeMonatssummeEur = earnings.history
    .slice(-4)
    .reduce((sum, e) => sum + e.amount, 0);
  const avgEurProTagMonat = rollierendeMonatssummeEur / 28; // 4 Wochen a 7 Tage, siehe Design-Doku

  await upsertDailyRow(sheets, SPREADSHEET_ID, {
    Datum: today,
    Ablesezeit: isNewWeek ? nowTime() : "",
    Anfangsguthaben_USD: isNewWeek ? weekStartBalance : "",
    GesamtwertUSD: gesamtwertUsd,
    TagesumsatzUSD: round2(tagesumsatzUsd),
    WochenumsatzUSD: round2(wochenumsatzUsd),
    DurchschnittUSD_Woche: round2(durchschnittUsd),
    FXRate_USD_EUR: fxRate,
    WochenumsatzEUR_ElevenLabs: wochenumsatzEurElevenLabs,
    WochenumsatzEUR_ueberFX: round2(wochenumsatzEurUeberFx),
    RollierendeMonatssummeEUR: round2(rollierendeMonatssummeEur),
    AvgEUR_ProTag_Monat: round2(avgEurProTagMonat),
  });

  await writeStatus(sheets, SPREADSHEET_ID, {
    readoutTimeWeekly: isNewWeek ? nowTime() : weekAnchorRow?.Ablesezeit ?? "",
    weekStartBalanceUsd: weekStartBalance,
    currentPeriodUsd: earnings.currentPeriod.amount,
    currentPeriodCurrency: earnings.currentPeriod.currency,
    allTimePayoutsEur: earnings.allTimePayouts.amount,
    lastUpdated: earnings.scrapedAt,
    stale: false,
    // intern fuer die naechste "neue Woche"-Erkennung:
    historyRowCount: currentCount,
  });

  console.log(
    `OK: ${today} | GesamtwertUSD=${gesamtwertUsd} | Wochenumsatz(EL)=${wochenumsatzEurElevenLabs} EUR | neueWoche=${isNewWeek}`
  );
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function nowTime() {
  return new Date().toTimeString().slice(0, 5);
}
function daysBetween(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86_400_000);
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

main().catch((err) => {
  console.error("Collector-Lauf fehlgeschlagen:", err);
  process.exit(1); // GitHub Actions markiert den Run als failed -> Fehler-Mail an Repo-Owner
});
