// Haupt-Collector. Läuft alle 10 Minuten via GitHub Actions (siehe
// .github/workflows/collect.yml). Liest ElevenLabs, berechnet die abgeleiteten
// Werte nach der verifizierten Sheet-Logik (siehe Design-Doku) und schreibt:
//   - "Automatisiert":  höchstens EINE Zeile pro Kalendertag (Upsert)
//   - "WeeklyHistory":  ALLE von ElevenLabs gemeldeten Wochen (voller Verlauf,
//                       upsert - wächst nie doppelt, wird nur ergänzt/aktualisiert)
//   - "Status":         Live-Snapshot bei JEDEM Lauf (für die App-Bridge)

import { chromium } from "playwright";
import { readEarnings } from "./elevenlabsReader.js";
import { getUsdToEurRate } from "./fx.js";
import {
  getAuthedSheets,
  ensureTabs,
  readDailyRows,
  upsertDailyRow,
  replaceAllRows,
  WEEKLY_HEADERS,
  WEEKLY_SHEET,
  readIntradayRows,
  INTRADAY_HEADERS,
  INTRADAY_SHEET,
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
  // WICHTIG: Zeitzone explizit pinnen, unabhaengig davon, ob dies auf GitHub Actions
  // (System-TZ UTC) oder lokal (System-TZ z.B. CEST) laeuft - siehe Bugfix 18.08.2026
  // in elevenlabsReader.js (parseElevenLabsDate).
  const context = await browser.newContext({ storageState, timezoneId: "Europe/Berlin" });
  const page = await context.newPage();

  let earnings;
  try {
    earnings = await readEarnings(page);
  } finally {
    await browser.close();
  }

  const fxRate = await getUsdToEurRate();

  // "Neue Woche"-Erkennung: History-Zeilenanzahl hat sich seit dem letzten Lauf erhöht
  // (der vorherige "Pending"-Eintrag wurde final "Paid", ein neuer "Pending"-Eintrag kam hinzu).
  const previousStatus = await readStatus(sheets, SPREADSHEET_ID);
  const lastKnownCount = Number(previousStatus.historyRowCount || 0);

  // Abrechnungstag statt Kalendertag (Nutzer-Feedback 21.08.2026: "die Balken muessen
  // 24h ab dem Auszahlungszeitpunkt berechnet werden, nicht um Mitternacht" - kurz
  // nach Mitternacht zeigte TagesumsatzUSD faelschlich fast 0, weil der Kalendertag
  // gerade erst begonnen hatte, obwohl die echte Abrechnungsperiode noch bis zur
  // taeglichen Ablesezeit lief). "today" faellt auf den VORHERIGEN Kalendertag zurueck,
  // solange die taegliche Ablesezeit (Uhrzeit von readoutTimeWeekly, jeden Tag
  // angewendet) noch nicht erreicht wurde - identische Logik wie
  // computeDailyAnchorMs() in apps-script/Code.gs fuer "Seit gestern". Ab jetzt teilen
  // sich Collector und Dashboard denselben Tages-Anker (vorher: Collector = Mitternacht,
  // Dashboard-Feld1 = Ablesezeit - liefen auseinander).
  const today = billingDayInBerlin(previousStatus.readoutTimeWeekly);

  const dailyRows = await readDailyRows(sheets, SPREADSHEET_ID);
  const sortedRows = [...dailyRows].sort((a, b) => (a.Datum < b.Datum ? -1 : 1));
  const currentCount = earnings.history.length;
  const isNewWeek = lastKnownCount === 0 || currentCount > lastKnownCount;

  const weekAnchorRow = isNewWeek
    ? null
    : [...sortedRows].reverse().find((r) => r.Anfangsguthaben_USD !== "");

  // KEIN Reset auf 0 (Korrektur 18.08.2026, siehe Nutzer-Feedback): ElevenLabs' "Current
  // Period"-Zaehler faellt bei einem woechentlichen Rollover NICHT zuverlaessig auf 0
  // zurueck, sondern kann ein Restguthaben aus der Vorperiode uebernehmen (am 18.08.2026
  // z.B. ca. $60 statt $0 - vom Nutzer per manueller Beobachtung bestaetigt). Deshalb wird
  // beim Rollover-Lauf der tatsaechlich ABGELESENE currentPeriod.amount als Startguthaben
  // uebernommen (Momentaufnahme direkt beim Rollover-Run) - nicht geraten/angenommen.
  const weekStartBalance = isNewWeek
    ? earnings.currentPeriod.amount
    : Number(weekAnchorRow?.Anfangsguthaben_USD ?? 0);

  const weekAnchorDate = isNewWeek ? today : weekAnchorRow?.Datum ?? today;
  const daysElapsedThisWeek = Math.max(1, daysBetween(weekAnchorDate, today) + 1);

  const yesterdayRow = [...sortedRows].reverse().find((r) => r.Datum < today);
  const previousE = yesterdayRow ? Number(yesterdayRow.GesamtwertUSD) : weekStartBalance;

  // Bugfix (18.08.2026): Bei einem zweiten Lauf am selben Tag darf die bereits in
  // einem frueheren Lauf HEUTE gesetzte Ablesezeit/Anfangsguthaben NICHT wieder auf
  // leer zurueckgesetzt werden, nur weil isNewWeek beim zweiten Lauf false ist.
  const todayExistingRow = sortedRows.find((r) => r.Datum === today);

  const gesamtwertUsd = earnings.currentPeriod.amount;

  // "Seit gestern dieser Uhrzeit": normalerweise die einfache Differenz zum gestrigen
  // Tageswert. Faellt der woechentliche Readout ZWISCHEN gestern und heute (die
  // aktuelle Periode hat also HEUTE erst begonnen), waere ein Vergleich mit dem
  // gestrigen - noch zur ALTEN Periode gehoerenden - Zaehlerstand irrefuehrend (der
  // Zaehler wurde ja gerade zurueckgesetzt). An einem Rollover-Tag zeigen wir daher
  // ersatzweise den Umsatz seit Periodenbeginn (beste verfuegbare Naeherung, siehe
  // Design-Doku). Bugfix (18.08.2026): frueher haengte dies an "isNewWeek" (nur im
  // Lauf wahr, der den Rollover erkennt) statt am Umstand, dass HEUTE der Periodenstart
  // ist - bei einem zweiten Lauf am selben Tag griff faelschlich der falsche Zweig.
  const periodStartedToday = weekAnchorDate === today;
  const tagesumsatzUsd = periodStartedToday
    ? gesamtwertUsd - weekStartBalance
    : gesamtwertUsd - previousE;
  const wochenumsatzUsd = gesamtwertUsd - weekStartBalance;
  const durchschnittUsd = wochenumsatzUsd / daysElapsedThisWeek;

  const latestHistoryEntry = earnings.history[earnings.history.length - 1];
  const wochenumsatzEurElevenLabs = latestHistoryEntry?.amount ?? "";
  const wochenumsatzEurUeberFx = wochenumsatzUsd * fxRate;

  const rollierendeMonatssummeEur = earnings.history
    .slice(-4)
    .reduce((sum, e) => sum + e.amount, 0);
  const avgEurProTagMonat = rollierendeMonatssummeEur / 28; // 4 Wochen a 7 Tage, siehe Design-Doku

  // ECHTE Ablesezeit von ElevenLabs (nicht die Uhrzeit des Collector-Laufs!) - siehe
  // Bugfix vom 18.08.2026: Nutzer meldete Abweichung (11:59 laut ElevenLabs vs. faelschlich
  // die Laufzeit des Skripts). latestHistoryEntry.dateIso ist der von ElevenLabs selbst
  // gemeldete Zeitstempel des aktuellen ("Pending") bzw. letzten Eintrags.
  const readoutIso = latestHistoryEntry?.dateIso ?? new Date().toISOString();

  await upsertDailyRow(sheets, SPREADSHEET_ID, {
    Datum: today,
    Ablesezeit: isNewWeek ? readoutIso : todayExistingRow?.Ablesezeit || "",
    Anfangsguthaben_USD: isNewWeek ? weekStartBalance : todayExistingRow?.Anfangsguthaben_USD || "",
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

  // Volle Wochen-Historie in EINEM Bulk-Write ersetzen (siehe sheetsClient.js -
  // ein Upsert pro Zeile hat live das API-Ratenlimit gesprengt).
  const weeklyRows = earnings.history
    .filter((e) => e.dateIso)
    .map((entry) => ({
      DatumZeit: entry.date,
      DatumIso: entry.dateIso,
      BetragEUR: entry.amount,
      Status: entry.status,
    }));
  await replaceAllRows(sheets, SPREADSHEET_ID, WEEKLY_SHEET, WEEKLY_HEADERS, weeklyRows);

  // Intraday-Snapshot fuer die "Tag"-Ansicht im Dashboard (echte Stunden-Kurve
  // heute vs. gestern statt nur des einen Tages-Endwerts). Bugfix (18.08.2026,
  // Nutzer-Feedback "dauerhaft verankert"): frueher wurden Eintraege aelter als 48h
  // verworfen - jetzt bleibt die volle Historie dauerhaft erhalten (kein Datenverlust
  // mehr), die "Tag"-Ansicht filtert sich ohnehin selbst auf das jeweils aktuelle
  // 24h-Fenster.
  const existingIntraday = await readIntradayRows(sheets, SPREADSHEET_ID);
  const keptIntraday = existingIntraday.filter((r) => r.Timestamp);
  keptIntraday.push({ Timestamp: earnings.scrapedAt, GesamtwertUSD: gesamtwertUsd });
  await replaceAllRows(sheets, SPREADSHEET_ID, INTRADAY_SHEET, INTRADAY_HEADERS, keptIntraday);

  await writeStatus(sheets, SPREADSHEET_ID, {
    // Bugfix (18.08.2026): "??" faengt nur null/undefined ab, NICHT einen leeren
    // String - eine (manuell oder durch einen Bug) leere Ablesezeit-Zelle wurde dadurch
    // 1:1 durchgereicht und hat readoutTimeWeekly geleert. "||" faengt auch "" ab.
    readoutTimeWeekly: isNewWeek ? readoutIso : weekAnchorRow?.Ablesezeit || readoutIso,
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
    `OK: ${today} | GesamtwertUSD=${gesamtwertUsd} | Wochenumsatz(EL)=${wochenumsatzEurElevenLabs} EUR | neueWoche=${isNewWeek} | Wochen-Historie=${earnings.history.length} Eintraege`
  );
}

// Heutiges Datum in deutscher Ortszeit (NICHT UTC) - sonst waere "heute" kurz nach
// Mitternacht deutscher Zeit faelschlich noch "gestern" (UTC-Tageswechsel liegt bis zu
// 2h spaeter). Siehe Bugfix 18.08.2026.
function todayInBerlin() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  return parts; // "en-CA" liefert direkt "YYYY-MM-DD"
}
// Siehe Kommentar bei der Verwendung oben. Bootstrap-Fall (noch keine Ablesezeit
// bekannt, z.B. beim allerersten Lauf): Kalendertag als Fallback.
function billingDayInBerlin(readoutIso) {
  const todayCalendar = todayInBerlin();
  if (!readoutIso) return todayCalendar;
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const readoutTimeOfDay = timeFmt.format(new Date(readoutIso));
  const nowTimeOfDay = timeFmt.format(new Date());
  if (nowTimeOfDay >= readoutTimeOfDay) return todayCalendar;
  const d = new Date(`${todayCalendar}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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
