/**
 * Datenbrücke (Google Apps Script Web App).
 * Liest die vom Collector befüllten Tabs "Status", "Automatisiert" und "WeeklyHistory"
 * und liefert sie als JSON aus - für das lokale HTML-Dashboard und die iOS-App.
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
  const weekly = readWeeklyRows(ss);
  const intraday = readIntradayRows(ss);

  const lastUpdated = status.lastUpdated ? new Date(status.lastUpdated) : null;
  const stale =
    !lastUpdated || Date.now() - lastUpdated.getTime() > STALE_AFTER_MINUTES * 60 * 1000;

  // Die drei wichtigsten Headline-Werte kommen direkt aus der HEUTIGEN Zeile in
  // "Automatisiert" (dort bereits korrekt berechnet, siehe collect.js):
  //   - sinceYesterdayUsd: echter 24h-Rückblick ("seit gestern dieser Uhrzeit")
  //   - thisWeekUsdNet:    Netto-Wochenwert (ohne den ElevenLabs-Anfangsrestwert)
  //   - avgDailyUsd:       Durchschnitts-Tageswert dieser Woche
  //
  // Bugfix (18.08.2026): NICHT einfach die letzte physische Zeile nehmen ("Automatisiert"
  // ist nicht garantiert chronologisch sortiert - z.B. durch einen Backfill-Lauf oder
  // manuelle Bearbeitung), sondern die Zeile mit dem heutigen Datum explizit suchen.
  const todayIso = Utilities.formatDate(new Date(), "Europe/Berlin", "yyyy-MM-dd");
  const todayRow = daily.find((r) => r.Datum === todayIso) || null;
  const sinceYesterdayUsd = Number(todayRow?.TagesumsatzUSD || 0);
  const thisWeekUsdNet = Number(todayRow?.WochenumsatzUSD || 0);

  const weeklySorted = weekly
    .filter((r) => r.DatumIso)
    .map((r) => ({ weekStart: r.DatumIso, eur: Number(r.BetragEUR || 0), status: r.Status }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));

  const yearlyAgg = buildPeriodAggregate(weekly, 4);
  const currentYear = String(new Date().getFullYear());
  const thisYearEur = (yearlyAgg.find((y) => y.year === currentYear) || {}).eur || 0;
  const lastYearEurSamePeriod = computeLastYearSamePeriodEur(weekly, todayIso);

  const monthlyAgg = buildPeriodAggregate(weekly, 7); // "YYYY-MM"
  const currentMonthKey = todayIso.slice(0, 7);
  const thisMonthEur = (monthlyAgg.find((m) => m.month === currentMonthKey) || {}).eur || 0;
  const lastMonthRow = [...monthlyAgg].reverse().find((m) => m.month < currentMonthKey);
  const lastMonthEur = lastMonthRow ? lastMonthRow.eur : null;

  const weekOverWeek = computeWeekOverWeek(daily, weeklySorted, todayIso);

  // Label fuer die erste Headline-Karte: "seit heute/gestern/DD.MM." - abhaengig davon,
  // WORAUF sich sinceYesterdayUsd tatsaechlich bezieht (siehe Nutzer-Feedback 18.08.2026):
  // startet die aktuelle Woche HEUTE (Rollover-Tag), bezieht sich der Wert auf den
  // Periodenbeginn heute ("seit heute"), sonst auf die letzte vorhandene Vortages-Zeile
  // ("seit gestern", oder bei einer Datenluecke ehrlich das tatsaechliche Datum).
  const thisWeekStartIso = weeklySorted.length
    ? Utilities.formatDate(new Date(weeklySorted[weeklySorted.length - 1].weekStart), "Europe/Berlin", "yyyy-MM-dd")
    : null;
  const periodStartedToday = thisWeekStartIso === todayIso;

  // "Ø pro Tag (diese Woche)" ist am Rollover-Tag selbst irrefuehrend (Division durch
  // nur 1 angebrochenen Tag) - erst ab dem Folgetag ist ein echter Tagesdurchschnitt
  // sinnvoll (siehe Nutzer-Feedback 18.08.2026).
  const avgDailyUsd = periodStartedToday ? null : Number(todayRow?.DurchschnittUSD_Woche || 0);

  const priorRow = [...daily]
    .filter((r) => r.Datum && r.Datum < todayIso)
    .sort((a, b) => (a.Datum < b.Datum ? 1 : -1))[0];
  let sinceLabelKind, sinceReferenceDate;
  if (periodStartedToday) {
    sinceLabelKind = "heute";
    sinceReferenceDate = todayIso;
  } else if (priorRow && daysBetweenIso(priorRow.Datum, todayIso) === 1) {
    sinceLabelKind = "gestern";
    sinceReferenceDate = priorRow.Datum;
  } else if (priorRow) {
    sinceLabelKind = "datum";
    sinceReferenceDate = priorRow.Datum;
  } else {
    sinceLabelKind = "gestern";
    sinceReferenceDate = todayIso;
  }

  const payload = {
    readoutTimeWeekly: status.readoutTimeWeekly || "",
    sinceYesterdayUsd: round2(sinceYesterdayUsd),
    sinceLabelKind: sinceLabelKind, // "heute" | "gestern" | "datum"
    sinceReferenceDate: sinceReferenceDate, // "YYYY-MM-DD"
    thisWeekUsdNet: round2(thisWeekUsdNet),
    avgDailyUsd: avgDailyUsd === null ? null : round2(avgDailyUsd),
    thisWeekEur: weeklySorted.length ? weeklySorted[weeklySorted.length - 1].eur : 0,
    thisWeekVsLastWeekPct: weekOverWeek ? weekOverWeek.pct : null, // null, falls nicht berechenbar (z.B. erste Woche)
    lastWeekUsdSameOffset: weekOverWeek ? weekOverWeek.lastWeekUsd : null,
    lastWeekAvgDailyUsd: weekOverWeek ? weekOverWeek.lastWeekAvgDailyUsd : null,
    thisYearEur: round2(thisYearEur),
    lastYearEurSamePeriod: lastYearEurSamePeriod === null ? null : round2(lastYearEurSamePeriod),
    fxRateUsdEur: Number(todayRow?.FXRate_USD_EUR || 0),
    thisMonthEur: round2(thisMonthEur),
    lastMonthEur: lastMonthEur === null ? null : round2(lastMonthEur),
    currentPeriodUsd: Number(status.currentPeriodUsd || 0),
    currentPeriodCurrency: status.currentPeriodCurrency || "USD",
    lastUpdated: status.lastUpdated || "",
    stale: stale,
    history: {
      daily: daily
        .filter((r) => r.Datum)
        .map((r) => ({ date: r.Datum, usd: Number(r.GesamtwertUSD || 0) }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
      weekly: weeklySorted,
      monthly: buildPeriodAggregate(weekly, 7), // "YYYY-MM"
      yearly: yearlyAgg, // "YYYY"
      intraday: intraday
        .filter((r) => r.Timestamp)
        .map((r) => ({ ts: r.Timestamp, usd: Number(r.GesamtwertUSD || 0) }))
        .sort((a, b) => (a.ts < b.ts ? -1 : 1)),
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
  return readSheetAsObjects(ss, "Automatisiert", normalizeDate);
}

function readIntradayRows(ss) {
  return readSheetAsObjects(ss, "Intraday", (obj) => {
    if (obj.Timestamp instanceof Date) {
      obj.Timestamp = Utilities.formatDate(obj.Timestamp, "UTC", "yyyy-MM-dd'T'HH:mm:ss'Z'");
    }
    return obj;
  });
}

function readWeeklyRows(ss) {
  return readSheetAsObjects(ss, "WeeklyHistory", (obj) => {
    if (obj.DatumIso instanceof Date) {
      obj.DatumIso = Utilities.formatDate(obj.DatumIso, "UTC", "yyyy-MM-dd'T'HH:mm:ss'Z'");
    }
    return obj;
  });
}

function readSheetAsObjects(ss, sheetName, normalize) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map((row) => {
    let obj = {};
    headers.forEach((h, i) => (obj[h] = row[i]));
    if (normalize) obj = normalize(obj);
    return obj;
  });
}

function normalizeDate(obj) {
  if (obj.Datum instanceof Date) {
    obj.Datum = Utilities.formatDate(obj.Datum, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return obj;
}

// Aggregiert die volle Wochen-Historie (reicht bis Feb 2025 zurück) auf Monats- oder
// Jahres-Ebene. sliceLen=7 -> "YYYY-MM", sliceLen=4 -> "YYYY".
function buildPeriodAggregate(weekly, sliceLen) {
  const byPeriod = {};
  weekly.forEach((r) => {
    const iso = r.DatumIso;
    if (!iso) return;
    // Bugfix (18.08.2026): DatumIso ist UTC (siehe readWeeklyRows) - ein rohes
    // String-Slice gruppiert daher an Monats-/Jahresgrenzen gelegentlich falsch (z.B.
    // Berlin "01.01. 01:00" landet als UTC-Zeitstempel noch im Vorjahr). Stattdessen
    // in deutscher Ortszeit formatieren, dann erst schneiden.
    const period = Utilities.formatDate(
      new Date(iso),
      "Europe/Berlin",
      sliceLen === 4 ? "yyyy" : "yyyy-MM"
    );
    byPeriod[period] = byPeriod[period] || { sumEur: 0, count: 0 };
    byPeriod[period].sumEur += Number(r.BetragEUR || 0);
    byPeriod[period].count += 1;
  });
  const key = sliceLen === 4 ? "year" : "month";
  return Object.entries(byPeriod)
    .map(([period, v]) => ({ [key]: period, eur: round2(v.sumEur), avgEur: round2(v.sumEur / v.count) }))
    .sort((a, b) => (a[key] < b[key] ? -1 : 1));
}

// Vorwochenvergleich: vergleicht den kumulierten Wochenwert dieser Woche am heutigen
// Tages-Offset (Tag N seit Wochenbeginn) mit dem WochenumsatzUSD der Vorwoche am
// GLEICHEN Offset - waehrungsneutral, da beide Seiten USD sind und "WochenumsatzUSD"
// pro Tag bereits den kumulierten Stand ab Wochenbeginn abbildet (siehe collect.js).
// Liefert null, wenn nicht genug Historie vorhanden ist. Liefert neben der %-Differenz
// auch den rohen Vorwochen-Wert und den Tages-Offset, damit das Dashboard darunter
// "Vorwoche: $X" bzw. den vergleichbaren Tagesdurchschnitt anzeigen kann.
function computeWeekOverWeek(daily, weeklySorted, todayIso) {
  if (weeklySorted.length < 2) return null;
  const thisWeekStart = Utilities.formatDate(
    new Date(weeklySorted[weeklySorted.length - 1].weekStart),
    "Europe/Berlin",
    "yyyy-MM-dd"
  );
  const lastWeekStart = Utilities.formatDate(
    new Date(weeklySorted[weeklySorted.length - 2].weekStart),
    "Europe/Berlin",
    "yyyy-MM-dd"
  );
  const daysElapsed = daysBetweenIso(thisWeekStart, todayIso); // 0 = Starttag der Woche
  const lastWeekSameOffsetDate = addDaysIso(lastWeekStart, daysElapsed);

  const lastRow = daily.find((r) => r.Datum === lastWeekSameOffsetDate);
  const thisRow = daily.find((r) => r.Datum === todayIso);
  const thisVal = Number(thisRow?.WochenumsatzUSD || 0);
  const lastVal = Number(lastRow?.WochenumsatzUSD || 0);
  if (!lastRow || lastVal === 0) return null;
  return {
    pct: round2(((thisVal - lastVal) / lastVal) * 100),
    lastWeekUsd: round2(lastVal),
    lastWeekAvgDailyUsd: round2(lastVal / (daysElapsed + 1)),
  };
}

// Vorjahresvergleich "bis zum gleichen Zeitpunkt": summiert die Vorjahres-Wochen bis
// (einschliesslich) zum gleichen Monat wie heute - fairer Vergleich statt des vollen
// Vorjahres (das waere immer groesser). Liefert null, wenn keine Vorjahresdaten da sind.
function computeLastYearSamePeriodEur(weekly, todayIso) {
  const lastYear = String(Number(todayIso.slice(0, 4)) - 1);
  const cutoffMonth = todayIso.slice(5, 7); // "MM"
  let sum = 0;
  let found = false;
  weekly.forEach((r) => {
    if (!r.DatumIso) return;
    const berlinDate = Utilities.formatDate(new Date(r.DatumIso), "Europe/Berlin", "yyyy-MM-dd");
    if (berlinDate.slice(0, 4) === lastYear && berlinDate.slice(5, 7) <= cutoffMonth) {
      sum += Number(r.BetragEUR || 0);
      found = true;
    }
  });
  return found ? sum : null;
}

function daysBetweenIso(a, b) {
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
}

function addDaysIso(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
