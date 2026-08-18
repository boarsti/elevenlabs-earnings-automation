/**
 * Datenbrücke (Google Apps Script Web App).
 * Liest die vom Collector befüllten Tabs "Status" und "Automatisiert" und liefert
 * sie als JSON aus - für das lokale HTML-Dashboard und die iOS-App.
 *
 * Deployment: Erweiterungen > Apps Script > dieses Skript einfügen > Bereitstellen >
 * Web App ("Wer hat Zugriff": Jeder). Siehe README.md in diesem Ordner.
 */

const ACCESS_TOKEN = "HIER_EIGENES_GEHEIMES_TOKEN_EINTRAGEN"; // siehe README
const STALE_AFTER_MINUTES = 30;

function doGet(e) {
  if (e?.parameter?.token !== ACCESS_TOKEN) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const status = readStatus(ss);
  const daily = readDailyRows(ss);

  const lastUpdated = status.lastUpdated ? new Date(status.lastUpdated) : null;
  const stale =
    !lastUpdated || Date.now() - lastUpdated.getTime() > STALE_AFTER_MINUTES * 60 * 1000;

  const weekStart = Number(status.weekStartBalanceUsd || 0);
  const currentPeriod = Number(status.currentPeriodUsd || 0);

  const payload = {
    readoutTimeWeekly: status.readoutTimeWeekly || "",
    sinceReadoutUsd: round2(currentPeriod - weekStart),
    currentPeriodUsd: currentPeriod,
    currentPeriodCurrency: status.currentPeriodCurrency || "USD",
    allTimePayoutsEur: Number(status.allTimePayoutsEur || 0),
    lastUpdated: status.lastUpdated || "",
    stale: stale,
    history: {
      daily: daily.map((r) => ({ date: r.Datum, usd: Number(r.GesamtwertUSD || 0) })),
      weekly: daily
        .filter((r) => r.Ablesezeit) // nur Wochen-Anker-Zeilen = ein Eintrag pro Woche
        .map((r) => ({ weekStart: r.Datum, eur: Number(r.WochenumsatzEUR_ElevenLabs || 0) })),
      monthly: buildMonthly(daily),
    },
  };

  return jsonResponse(payload, 200);
}

function readStatus(ss) {
  const sheet = ss.getSheetByName("Status");
  if (!sheet) return {};
  const [headers, values] = sheet.getDataRange().getValues();
  const row = values || [];
  const out = {};
  headers.forEach((h, i) => (out[h] = row[i]));
  return out;
}

function readDailyRows(ss) {
  const sheet = ss.getSheetByName("Automatisiert");
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = row[i]));
    // Datum als YYYY-MM-DD normalisieren, falls Sheets es als Date-Objekt liefert
    if (obj.Datum instanceof Date) {
      obj.Datum = Utilities.formatDate(obj.Datum, Session.getScriptTimeZone(), "yyyy-MM-dd");
    }
    return obj;
  });
}

function buildMonthly(daily) {
  const byMonth = {};
  daily.forEach((r) => {
    if (!r.Datum) return;
    const month = String(r.Datum).slice(0, 7); // "YYYY-MM"
    byMonth[month] = byMonth[month] || { sumUsd: 0, count: 0 };
    byMonth[month].sumUsd += Number(r.TagesumsatzUSD || 0);
    byMonth[month].count += 1;
  });
  return Object.entries(byMonth).map(([month, v]) => ({
    month,
    usd: round2(v.sumUsd),
    avgUsd: round2(v.sumUsd / v.count),
  }));
}

function jsonResponse(obj, _statusCode) {
  // Apps-Script-Web-Apps können den HTTP-Status nicht frei setzen; Fehler werden
  // stattdessen im JSON-Body als {error:...} signalisiert (vom Client zu prüfen).
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
