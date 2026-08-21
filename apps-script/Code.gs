/**
 * Datenbrücke (Google Apps Script Web App).
 * Liest die vom Collector befüllten Tabs "Status", "Automatisiert" und "WeeklyHistory"
 * und liefert sie als JSON aus - für das lokale HTML-Dashboard und die iOS-App.
 *
 * Deployment: Erweiterungen > Apps Script > dieses Skript einfügen > Bereitstellen >
 * Web App ("Wer hat Zugriff": Jeder). Siehe README.md in diesem Ordner.
 */
const ACCESS_TOKEN = "1088d19ba9d9fb5910f0e9b2ee07fea7"; // rotiert am 19.08.2026 (Security-Audit)
const STALE_AFTER_MINUTES = 90; // an die ~stuendliche GitHub-Actions-Taktung angepasst (Nutzer-Feedback 19.08.2026)
// GitHub-Repo des Collector-Workflows (siehe .github/workflows/collect.yml) - kein
// Geheimnis, daher hier direkt im Code statt als Script-Property.
const GITHUB_REPO = "boarsti/elevenlabs-earnings-automation";
const GITHUB_WORKFLOW_FILE = "collect.yml";
const GITHUB_BRANCH = "main";

function doGet(e) {
  if (e?.parameter?.token !== ACCESS_TOKEN) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  // Manueller Collector-Trigger vom Dashboard-Refresh-Button (Nutzer-Feedback
  // 20.08.2026): loest den GitHub-Actions-Workflow sofort aus, statt auf den
  // naechsten Cron-Lauf zu warten. Der GitHub-Token liegt ausschliesslich als
  // Script-Property (PropertiesService) - nie im Code, nie im Client sichtbar.
  if (e?.parameter?.action === "triggerCollector") {
    return triggerCollectorWorkflow();
  }
  return jsonResponse(computeSummary(), 200);
}

// Kernberechnung, aus doGet() herausgezogen (Nutzer-Anforderung 20.08.2026: woechentlicher
// Email-Report) - damit sendWeeklyReportEmail() dieselben Zahlen liefert wie die
// Datenbruecke, statt einer zweiten, eigenstaendigen Berechnung, die mit der Zeit
// auseinanderlaufen koennte.
function computeSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const status = readStatus(ss);
  const dailyRaw = readDailyRows(ss);
  const weekly = readWeeklyRows(ss);
  const intraday = readIntradayRows(ss);
  const lastUpdated = status.lastUpdated ? new Date(status.lastUpdated) : null;
  const stale = !lastUpdated || Date.now() - lastUpdated.getTime() > STALE_AFTER_MINUTES * 60 * 1000;
  // "heute" = Abrechnungstag (11:59-zu-11:59), NICHT Kalender-Mitternacht (Nutzer-
  // Feedback 21.08.2026: Feld3 "Ø pro Tag" fiel genau um 0:00 Uhr ab, obwohl sich erst
  // um 11:59 etwas aendern sollte - lag daran, dass computeSummary() weiterhin die
  // Kalender-Mitternacht nutzte, waehrend der Collector (collect.js) bereits am selben
  // Tag auf den 11:59-Anker umgestellt wurde). Identische Logik wie billingDayInBerlin()
  // im Collector, hier als billingDayIso() - siehe computeDailyAnchorMs() weiter unten
  // fuer denselben Ansatz auf Millisekunden-Ebene (Feld1 "Seit gestern").
  const todayIso = billingDayIso(status.readoutTimeWeekly);
  // Sicherheitsfilter: verwirft Zeilen, deren Datum NACH dem aktuellen Abrechnungstag
  // liegt - faengt z.B. eine "Geister-Zeile" ab, die der Collector VOR der Umstellung
  // auf den 11:59-Anker faelschlich schon fuer den naechsten Kalendertag angelegt hat
  // (Nutzer-Feedback 21.08.2026: "in KW34 optisch schon der Datenpunkt 11:59 sichtbar,
  // obwohl die Uhrzeit noch nicht erreicht ist") - ohne diesen Filter wuerde so eine
  // verfrueht datierte Zeile trotzdem in Charts/Balken auftauchen, weil sie ja
  // tatsaechlich im Sheet steht.
  const daily = dailyRaw.filter((r) => !r.Datum || r.Datum <= todayIso);
  // Faellt auf den zuletzt bekannten Tages-Datensatz zurueck, wenn fuer "heute" noch
  // keine Zeile existiert (Nutzer-Feedback 21.08.2026: Email-Report kurz nach
  // Mitternacht zeigte "Diese Woche"/"Ø pro Tag"/"Kurs" als 0,00 $/"—", weil der
  // stuendliche Collector fuer den neuen Tag noch nicht gelaufen war). "daily" ist
  // chronologisch aufsteigend (Sheet-Schreibreihenfolge), das letzte Element ist
  // also der zuletzt bekannte Stand - betrifft Dashboard UND Email-Report gleichermassen,
  // da beide auf demselben computeSummary()-Ergebnis aufbauen.
  const todayRow = daily.find((r) => r.Datum === todayIso) || daily[daily.length - 1] || null;
  const thisWeekUsdNet = Number(todayRow?.WochenumsatzUSD || 0);
  const intradaySorted = intraday
    .filter((r) => r.Timestamp)
    .map((r) => ({ ts: r.Timestamp, usd: parseFlexibleNumber(r.GesamtwertUSD) }))
    .filter((r) => r.usd !== null && !isNaN(r.usd))
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const currentPeriodUsdNow = Number(status.currentPeriodUsd || 0);
  const weekStartBalanceUsd = Number(status.weekStartBalanceUsd || 0);
  const readoutMs = status.readoutTimeWeekly ? new Date(status.readoutTimeWeekly).getTime() : null;

  // Tages-Counter (Feld1): zaehlt seit dem taeglichen Reset-Zeitpunkt, der sich IMMER
  // nach der Uhrzeit des letzten woechentlichen Ablese-/Auszahlungszeitpunkts richtet
  // (status.readoutTimeWeekly) - diese Uhrzeit variiert von Woche zu Woche, gilt aber
  // dann jeden Tag als fester Reset-Punkt (Nutzer-Feedback 19.08.2026: NICHT "die
  // letzten 24h ab jetzt", sondern ein exakter taeglicher Reset auf $0,00 an dieser
  // festen Uhrzeit).
  let sinceYesterdayUsd, sinceAnchorIso;
  if (readoutMs && nowMs - readoutMs < dayMs) {
    // Wir sind noch innerhalb der ersten 24h nach dem tatsaechlichen woechentlichen
    // Ablesezeitpunkt - dort ist weekStartBalanceUsd die exakte, unmittelbare Basis
    // (kein Suchen in der Intraday-Historie noetig).
    sinceYesterdayUsd = currentPeriodUsdNow - weekStartBalanceUsd;
    sinceAnchorIso = status.readoutTimeWeekly;
  } else if (readoutMs) {
    const anchorMs = computeDailyAnchorMs(readoutMs, nowMs, dayMs);
    const baseline = valueAtOrBefore(intradaySorted, anchorMs);
    if (baseline !== null) {
      sinceYesterdayUsd = currentPeriodUsdNow - baseline;
      sinceAnchorIso = new Date(anchorMs).toISOString();
    } else {
      sinceYesterdayUsd = Number(todayRow?.TagesumsatzUSD || 0);
      sinceAnchorIso = null;
    }
  } else {
    sinceYesterdayUsd = Number(todayRow?.TagesumsatzUSD || 0);
    sinceAnchorIso = null;
  }
  const weeklySortedRaw = weekly
    .filter((r) => r.DatumIso)
    .map((r) => ({ weekStart: r.DatumIso, eur: Number(r.BetragEUR || 0), status: r.Status }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  const weeklySorted = weeklySortedRaw.map((w, i) => {
    const next = weeklySortedRaw[i + 1];
    if (!next) return { ...w, avgPerDayEur: null };
    const days = Math.max(1, daysBetweenIso(w.weekStart.slice(0, 10), next.weekStart.slice(0, 10)));
    return { ...w, avgPerDayEur: round2(w.eur / days) };
  });
  const yearlyAgg = buildPeriodAggregate(weekly, 4);
  const currentYear = String(new Date().getFullYear());
  const thisYearEur = (yearlyAgg.find((y) => y.year === currentYear) || {}).eur || 0;
  const lastYearEurSamePeriod = computeLastYearSamePeriodEur(weekly, todayIso);
  const monthlyAgg = buildPeriodAggregate(weekly, 7);
  const currentMonthKey = todayIso.slice(0, 7);
  const thisMonthEur = (monthlyAgg.find((m) => m.month === currentMonthKey) || {}).eur || 0;
  const lastMonthRow = [...monthlyAgg].reverse().find((m) => m.month < currentMonthKey);
  const lastMonthEur = lastMonthRow ? lastMonthRow.eur : null;
  const weekOverWeek = computeWeekOverWeek(daily, weeklySorted, todayIso);
  const thisWeekStartIso = weeklySorted.length ? Utilities.formatDate(new Date(weeklySorted[weeklySorted.length - 1].weekStart), "Europe/Berlin", "yyyy-MM-dd") : null;
  const periodStartedToday = thisWeekStartIso === todayIso;
  const avgDailyUsd = periodStartedToday ? null : Number(todayRow?.DurchschnittUSD_Woche || 0);
  const nextReadoutEstimate = estimateNextReadout(weekly);
  const payload = {
    readoutTimeWeekly: status.readoutTimeWeekly || "",
    nextReadoutEstimateIso: nextReadoutEstimate ? new Date(nextReadoutEstimate.estimateMs).toISOString() : "",
    nextReadoutEstimateStddevHours: nextReadoutEstimate ? nextReadoutEstimate.stddevHours : null,
    sinceYesterdayUsd: round2(sinceYesterdayUsd),
    sinceAnchorIso: sinceAnchorIso || "",
    thisWeekUsdNet: round2(thisWeekUsdNet),
    avgDailyUsd: avgDailyUsd === null ? null : round2(avgDailyUsd),
    thisWeekEur: weeklySorted.length ? weeklySorted[weeklySorted.length - 1].eur : 0,
    lastWeekEurDirect: weeklySorted.length >= 2 ? weeklySorted[weeklySorted.length - 2].eur : null,
    thisWeekVsLastWeekPct: weekOverWeek ? weekOverWeek.pct : null,
    lastWeekUsdSameOffset: weekOverWeek ? weekOverWeek.lastWeekUsd : null,
    lastWeekAvgDailyUsd: weekOverWeek ? weekOverWeek.lastWeekAvgDailyUsd : null,
    thisYearEur: round2(thisYearEur),
    lastYearEurSamePeriod: lastYearEurSamePeriod === null ? null : round2(lastYearEurSamePeriod),
    fxRateUsdEur: Number(todayRow?.FXRate_USD_EUR || 0),
    thisMonthEur: round2(thisMonthEur),
    lastMonthEur: lastMonthEur === null ? null : round2(lastMonthEur),
    currentPeriodUsd: Number(status.currentPeriodUsd || 0),
    // Zaehlerstand GENAU beim woechentlichen Rollover - Basis fuer die "ab 0"-Skalierung
    // der Tagesansicht, wenn fuer den exakten Fensterbeginn keine Intraday-Daten
    // existieren (Kaltstart-Luecke, siehe Nutzer-Feedback 19.08.2026).
    weekStartBalanceUsd: weekStartBalanceUsd,
    currentPeriodCurrency: status.currentPeriodCurrency || "USD",
    lastUpdated: status.lastUpdated || "",
    stale: stale,
    // Branchennews (Nutzer-Anforderung 20.08.2026: Marktereignisse rund um Audio/KI/
    // ChatBots optisch in den Verlauf einfliessen lassen) - siehe fetchIndustryNews()
    // weiter unten fuer die Sammel-Logik.
    industryNews: readIndustryNews(ss),
    history: {
      daily: buildDailyHistoryWithBackfill(daily),
      weekly: weeklySorted,
      monthly: buildPeriodAggregate(weekly, 7),
      yearly: yearlyAgg,
      intraday: intraday.filter((r) => r.Timestamp).map((r) => ({ ts: r.Timestamp, usd: parseFlexibleNumber(r.GesamtwertUSD) })).sort((a, b) => (a.ts < b.ts ? -1 : 1)),
    },
  };
  return payload;
}

// Loest ".github/workflows/collect.yml" ueber die GitHub REST API aus
// (workflow_dispatch). Der Token kommt ausschliesslich aus den Script-Properties
// (Projekteinstellungen > Skripteigenschaften > GITHUB_PAT) - dort vom Nutzer selbst
// eingetragen, landet nie im Code oder in der Git-Historie.
function triggerCollectorWorkflow() {
  const pat = PropertiesService.getScriptProperties().getProperty("GITHUB_PAT");
  if (!pat) {
    return jsonResponse({ ok: false, error: "GITHUB_PAT ist nicht in den Skripteigenschaften gesetzt." }, 500);
  }
  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_FILE}/dispatches`;
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "elevenlabs-earnings-dashboard",
    },
    payload: JSON.stringify({ ref: GITHUB_BRANCH }),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  // GitHub antwortet bei Erfolg mit 204 No Content (kein Body).
  if (status === 204) {
    return jsonResponse({ ok: true }, 200);
  }
  return jsonResponse({ ok: false, error: `GitHub-API antwortete mit ${status}: ${response.getContentText()}` }, 502);
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
function buildPeriodAggregate(weekly, sliceLen) {
  const byPeriod = {};
  weekly.forEach((r) => {
    const iso = r.DatumIso;
    if (!iso) return;
    const period = Utilities.formatDate(new Date(iso), "Europe/Berlin", sliceLen === 4 ? "yyyy" : "yyyy-MM");
    byPeriod[period] = byPeriod[period] || { sumEur: 0, count: 0 };
    byPeriod[period].sumEur += Number(r.BetragEUR || 0);
    byPeriod[period].count += 1;
  });
  const key = sliceLen === 4 ? "year" : "month";
  return Object.entries(byPeriod).map(([period, v]) => ({ [key]: period, eur: round2(v.sumEur), avgEur: round2(v.sumEur / v.count) })).sort((a, b) => (a[key] < b[key] ? -1 : 1));
}
function computeWeekOverWeek(daily, weeklySorted, todayIso) {
  if (weeklySorted.length < 2) return null;
  const thisWeekStart = Utilities.formatDate(new Date(weeklySorted[weeklySorted.length - 1].weekStart), "Europe/Berlin", "yyyy-MM-dd");
  const lastWeekStart = Utilities.formatDate(new Date(weeklySorted[weeklySorted.length - 2].weekStart), "Europe/Berlin", "yyyy-MM-dd");
  const daysElapsed = daysBetweenIso(thisWeekStart, todayIso);
  const lastWeekSameOffsetDate = addDaysIso(lastWeekStart, daysElapsed);
  // Sucht bei fehlendem/leerem WochenumsatzUSD am exakten Vorwochen-Offset-Tag im
  // +/-2-Tage-Fenster nach der naechstgelegenen Zeile mit einem echten Wert - macht
  // den Vergleich robust gegen einzelne Datenluecken im Sheet (Nutzer-Feedback
  // 21.08.2026: "Vorwoche —" trotz vorhandener Historie; Ursache war eine leere
  // WochenumsatzUSD-Zelle fuer genau den Offset-Tag, 12.08.2026, vermutlich aus der
  // Uebergangsphase zur 11:59-Anker-Umstellung).
  function findValidRow(targetIso) {
    for (let delta = 0; delta <= 2; delta++) {
      const signs = delta === 0 ? [0] : [-1, 1];
      for (const sign of signs) {
        const candidateIso = addDaysIso(targetIso, delta * sign);
        const row = daily.find((r) => r.Datum === candidateIso);
        if (row && row.WochenumsatzUSD !== "" && row.WochenumsatzUSD !== undefined && row.WochenumsatzUSD !== null) {
          return row;
        }
      }
    }
    return null;
  }
  const lastRow = findValidRow(lastWeekSameOffsetDate);
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
function computeLastYearSamePeriodEur(weekly, todayIso) {
  const lastYear = String(Number(todayIso.slice(0, 4)) - 1);
  const cutoffMonth = todayIso.slice(5, 7);
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
// Schaetzt den naechsten Ablesezeitpunkt aus der Drift der letzten Auszahlungen
// (Nutzer-Anforderung 21.08.2026, nach gemeinsamer Analyse aller Ablesezeitpunkte
// seit Feb 2025 im Chat): Feld2s "Prognose bis Wochenende" nahm bisher einfach
// readoutTimeWeekly + 7 Tage an. Tatsaechlich zeigen die 74 historischen Abstaende
// zwei Regime - bis ca. 07.03.2026 ein festes 2x-taeglich-Batch-Raster (fast immer
// exakt 7 oder 7,5 Tage), danach (vermutlich nach einer Systemumstellung bei
// ElevenLabs) eine kontinuierlichere Verteilung zwischen 7,0 und 8,2 Tagen ohne
// festes Zeitraster mehr. Bewusst ein ROLLIERENDES Fenster (letzte 10 Abstaende)
// statt eines festen Stichtags fuer den Regimewechsel - damit sich die Schaetzung
// automatisch anpasst, falls sich der Rhythmus erneut aendert, ohne Code-Aenderung.
const NEXT_READOUT_WINDOW = 10;
function estimateNextReadout(weeklyRaw) {
  // DatumZeit kommt vom Sheet nicht zuverlaessig als Date-Objekt zurueck (haengt
  // davon ab, ob die Zelle als echter Datumswert oder als Text geschrieben wurde) -
  // deshalb robust ueber new Date() parsen statt instanceof Date vorauszusetzen.
  const sorted = weeklyRaw
    .map((r) => (r.DatumZeit instanceof Date ? r.DatumZeit : new Date(r.DatumZeit)))
    .filter((d) => !isNaN(d.getTime()))
    .map((d) => d.getTime())
    .sort((a, b) => a - b);
  if (sorted.length < 4) return null; // zu wenig Historie fuer eine belastbare Schaetzung
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
  const recentGaps = gaps.slice(-NEXT_READOUT_WINDOW);
  const meanMs = recentGaps.reduce((a, g) => a + g, 0) / recentGaps.length;
  const variance = recentGaps.reduce((a, g) => a + (g - meanMs) * (g - meanMs), 0) / recentGaps.length;
  const lastMs = sorted[sorted.length - 1];
  return {
    estimateMs: lastMs + meanMs,
    stddevHours: round2(Math.sqrt(variance) / 3600000),
    sampleSize: recentGaps.length,
  };
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
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function parseFlexibleNumber(v) {
  if (v === "" || v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

// Rekonstruiert TagesumsatzUSD rueckwirkend aus den GesamtwertUSD-Differenzen
// aufeinanderfolgender Tage, wenn kein echter (vom Collector direkt geschriebener)
// Wert vorliegt (Nutzer-Feedback 19.08.2026: "TagesumsatzUSD rueckwirkend
// auffuellen"). Nur uebernommen, wenn der Zaehler zwischen den beiden Tagen NICHT
// gesunken ist - ein Ruecksetzer bedeutet woechentlichen Rollover, und der echte
// Tageswert direkt nach einem Rollover laesst sich aus diesen zwei Werten allein
// nicht rekonstruieren (das Anfangsguthaben der neuen Woche fehlt hier). Solche
// Tage bleiben bewusst null statt eines falschen Werts.
function buildDailyHistoryWithBackfill(daily) {
  const sorted = daily
    .filter((r) => r.Datum)
    .map((r) => ({
      date: r.Datum,
      usd: Number(r.GesamtwertUSD || 0),
      rawTagesumsatzUsd: r.TagesumsatzUSD === "" || r.TagesumsatzUSD === undefined ? null : Number(r.TagesumsatzUSD),
      // Markiert den Rollover-Tag (Wochenanfang) - direkt aus der Spalte, die der
      // Collector nur an genau diesem einen Tag pro Woche befuellt. Frontend-Bedarf
      // (Nutzer-Feedback 21.08.2026: "das Koordinatensystem in KW34 muss immer am
      // Starttag [der Ablesezeit] starten" statt an der Kalenderwoche) - das
      // Wochen-Diagramm braucht den echten Abrechnungs-Wochenanfang statt einer
      // ISO-Kalenderwoche.
      isWeekAnchor: r.Anfangsguthaben_USD !== "" && r.Anfangsguthaben_USD !== undefined && r.Anfangsguthaben_USD !== null,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return sorted.map((d, i) => {
    let tagesumsatzUsd = d.rawTagesumsatzUsd;
    if (tagesumsatzUsd === null && i > 0) {
      const delta = d.usd - sorted[i - 1].usd;
      if (delta >= 0) tagesumsatzUsd = round2(delta);
    }
    return { date: d.date, usd: d.usd, tagesumsatzUsd: tagesumsatzUsd, isWeekAnchor: d.isWeekAnchor };
  });
}

// Ermittelt den taeglichen Reset-Zeitpunkt (Uhrzeit von readoutTimeWeekly, jeden Tag
// angewendet): heute, falls diese Uhrzeit heute bereits erreicht wurde, sonst gestern.
function computeDailyAnchorMs(readoutMs, nowMs, dayMs) {
  const timeOfDay = Utilities.formatDate(new Date(readoutMs), "Europe/Berlin", "HH:mm:ss");
  const todayDate = Utilities.formatDate(new Date(nowMs), "Europe/Berlin", "yyyy-MM-dd");
  const todayAnchorMs = Utilities.parseDate(`${todayDate} ${timeOfDay}`, "Europe/Berlin", "yyyy-MM-dd HH:mm:ss").getTime();
  return nowMs >= todayAnchorMs ? todayAnchorMs : todayAnchorMs - dayMs;
}

// "Heutiger" Abrechnungstag als ISO-Datum ("YYYY-MM-DD") - identisch zu
// billingDayInBerlin() im Collector (collector/src/collect.js): faellt auf den
// vorherigen Kalendertag zurueck, solange die taegliche Ablesezeit noch nicht
// erreicht ist. Nutzt computeDailyAnchorMs() (siehe oben) fuer denselben
// Millisekunden-Anker wie Feld1 "Seit gestern" - beide Werte muessen zwingend
// dieselbe Tagesgrenze verwenden, sonst laufen sie wieder auseinander (Nutzer-
// Feedback 21.08.2026). Bootstrap-Fall (noch keine Ablesezeit bekannt): Kalendertag.
function billingDayIso(readoutTimeWeeklyIso) {
  const todayCalendar = Utilities.formatDate(new Date(), "Europe/Berlin", "yyyy-MM-dd");
  if (!readoutTimeWeeklyIso) return todayCalendar;
  const readoutMs = new Date(readoutTimeWeeklyIso).getTime();
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const anchorMs = computeDailyAnchorMs(readoutMs, nowMs, dayMs);
  return Utilities.formatDate(new Date(anchorMs), "Europe/Berlin", "yyyy-MM-dd");
}

// Letzter bekannter Intraday-Messwert AM ODER VOR dem Ziel-Zeitpunkt (nicht der
// zeitlich naechstgelegene - sonst waere bei fehlenden Messpunkten faelschlich ein
// Wert NACH dem taeglichen Reset-Zeitpunkt die Basis, siehe Nutzer-Feedback 19.08.2026).
function valueAtOrBefore(intradaySorted, targetMs) {
  let result = null;
  for (const p of intradaySorted) {
    if (new Date(p.ts).getTime() <= targetMs) {
      result = p.usd;
    } else {
      break;
    }
  }
  return result;
}

// ============================================================================
// Woechentlicher Email-Report (Nutzer-Anforderung 20.08.2026: "montags um Punkt 8
// Uhr ein Wochen-Reporting als Email, schoen aufbereitet"). Nutzt MailApp (Googles
// eingebauter Mailversand unter dem eigenen Konto) statt einer externen Mail-API -
// braucht dadurch KEIN neues Secret/SMTP-Passwort, nur eine einmalige Google-
// Berechtigung ("E-Mails senden"), die nur der Kontoinhaber selbst bestaetigen kann
// (siehe setupWeeklyReportTrigger unten). Einrichtung: siehe apps-script/README.md.
// ============================================================================

// Identischer ISO-Wochennummer-Algorithmus wie im HTML-Dashboard (isoWeekNumber in
// index.html) - garantiert, dass "KW34" im Report exakt zur Dashboard-Anzeige passt.
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

// Design-Tokens 1:1 aus html-dashboard/index.html uebernommen (Nutzer-Anforderung
// 20.08.2026: "muss exakt das Design der html uebernehmen") - selbe Hex-Werte wie
// die CSS-Variablen --bg/--text/--muted/--card-bg/--card-border sowie die im
// Dashboard fest verdrahteten Akzentfarben TREND_UP_COLOR/TREND_DOWN_COLOR und die
// Status-Farben aus historyTableBody (paid ? "#3FBF6F" : "#B35A0A"). Bei einer
// Aenderung des Dashboard-Farbschemas MUESSEN diese Werte hier mitgezogen werden,
// sonst laufen Dashboard und Email-Report wieder auseinander.
//
// Nutzer-Feedback 20.08.2026 (2. Runde): "Hintergrund nicht grau sondern dunkelblau
// gemaess Design CD/CI" - das entspricht 1:1 dem DARK-MODE-Farbschema des
// Dashboards (@media (prefers-color-scheme: dark) in html-dashboard/index.html),
// nicht dem hellen Standard-Modus. Email-Clients koennen kein "prefers-color-scheme"
// zuverlaessig auswerten, deshalb hier fest auf das dunkle Schema verdrahtet statt
// beide Varianten per Media Query anzubieten.
const EMAIL_COLOR_BG = "#0b0f2b";
const EMAIL_COLOR_TEXT = "#f1f2fa";
const EMAIL_COLOR_MUTED = "#9aa0c7";
const EMAIL_COLOR_CARD_BG = "#182055";
const EMAIL_COLOR_CARD_BORDER = "#29347a";
const EMAIL_COLOR_TREND_UP = "#FF8A1F"; // Anstieg - identisch zu TREND_UP_COLOR im Dashboard
const EMAIL_COLOR_TREND_DOWN = "#3355FF"; // Rueckgang - identisch zu TREND_DOWN_COLOR im Dashboard
const EMAIL_COLOR_SUCCESS = "#3FBF6F"; // "Ausgezahlt" - identisch zur Payout-Tabelle im Dashboard
const EMAIL_COLOR_PENDING = "#B35A0A"; // "Ausstehend" - identisch zur Payout-Tabelle im Dashboard
// Font-Stacks identisch zur Tailwind-Konfiguration im Dashboard (font-display =
// Archivo, body = Inter, font-num = IBM Plex Mono). Web-Fonts werden per @import
// versucht (von Gmail/Apple Mail groesstenteils unterstuetzt), mit denselben
// System-Fallbacks wie im Dashboard, falls ein Mail-Client sie ignoriert.
const EMAIL_FONT_DISPLAY = "'Archivo','Segoe UI',sans-serif";
const EMAIL_FONT_BODY = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
const EMAIL_FONT_NUM = "'IBM Plex Mono',ui-monospace,monospace";
// Dasselbe App-Icon wie im Dashboard-Header (<img ... alt="Logo">, html-dashboard/index.html)
// - fuer den Wiedererkennungswert 1:1 aus der dortigen Base64-Kodierung uebernommen.
const EMAIL_LOGO_DATA_URI = "data:image/png;base64,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";

// Montag-verankerter ISO-Wochenschluessel, identisch zu isoWeekKey() im Dashboard
// (html-dashboard/index.html) - Basis fuer den woechentlichen Tagesumsatz-Chart im
// Email-Report weiter unten.
function isoWeekKeyGs(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayOffset = (d.getUTCDay() + 6) % 7; // Mo=0 ... So=6
  d.setUTCDate(d.getUTCDate() - dayOffset);
  return d.toISOString().slice(0, 10);
}

// Durchschnitt TagesumsatzUSD je Wochentag (0=So...6=Sa), identisch zu
// computeWeekdayAverages() im Dashboard - Basis fuer die Monats-Hochrechnung.
function computeWeekdayAveragesGs(daily) {
  const withVal = (daily || []).filter((d) => d.tagesumsatzUsd !== null && d.tagesumsatzUsd !== undefined);
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  withVal.forEach((d) => {
    const wd = new Date(d.date + "T00:00:00Z").getUTCDay();
    sums[wd] += d.tagesumsatzUsd;
    counts[wd] += 1;
  });
  return sums.map((s, i) => (counts[i] ? s / counts[i] : null));
}

// Hochrechnung des laufenden Monats, identisch zu computeMonthProjection() im
// Dashboard (Nutzer-Anforderung 20.08.2026, 2. Runde: "liefere die Monatsprognose
// mit, bis Monatsende, dann neu generieren") - wird bei jedem Mailversand live neu
// berechnet (kein gespeicherter Zustand), daher automatisch korrekt nach jedem
// Monatswechsel.
function computeMonthProjectionGs(daily, year, month) {
  const avgs = computeWeekdayAveragesGs(daily);
  const withVal = daily.filter((d) => d.tagesumsatzUsd !== null && d.tagesumsatzUsd !== undefined);
  const fallback = withVal.length ? withVal.reduce((a, d) => a + d.tagesumsatzUsd, 0) / withVal.length : 0;
  const byDate = {};
  daily.forEach((d) => { byDate[d.date] = d; });
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let sum = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const row = byDate[iso];
    if (row && row.tagesumsatzUsd !== null && row.tagesumsatzUsd !== undefined) {
      sum += row.tagesumsatzUsd;
    } else {
      const wd = new Date(iso + "T00:00:00Z").getUTCDay();
      sum += avgs[wd] !== null && avgs[wd] !== undefined ? avgs[wd] : fallback;
    }
  }
  return sum;
}

// Einfache proportionale Jahres-Hochrechnung, identisch zur Formel im Dashboard
// (buildYearlyBars: data.thisYearEur * (daysInYear / daysElapsed)) - Nutzer-
// Anforderung 20.08.2026, 2. Runde: "liefere die aktualisierte Jahresprognose aus".
function computeYearProjectionGs(thisYearEur) {
  const now = new Date();
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const daysElapsed = Math.max(1, Math.floor((now - startOfYear) / 86400000) + 1);
  const y = now.getUTCFullYear();
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInYear = isLeap ? 366 : 365;
  return thisYearEur * (daysInYear / daysElapsed);
}

// Tagesumsatz-Balken der aktuellen (Montag-verankerten) Kalenderwoche - identisch
// zum Chart "Tagesumsatz (diese Woche)" in der Tag-Ansicht des Dashboards
// (buildWeekCompare -> thisWeekDailyUsd in html-dashboard/index.html). Nutzer-
// Anforderung 20.08.2026, 2. Runde: "liefere in der Mail den Graphen mit, der bei
// Tag (Do 20.08.) die ganze Woche vollstaendig generiert wurde" - reine Ist-Werte
// fuer die bereits vergangenen Tage, keine erfundene Prognose-Ueberlagerung
// (identisch zum Original-Chart im Dashboard).
function buildCurrentWeekDailyUsdGs(daily) {
  const byWeek = {};
  (daily || []).forEach((p) => {
    const wk = isoWeekKeyGs(p.date);
    (byWeek[wk] = byWeek[wk] || []).push(p);
  });
  const weekKeys = Object.keys(byWeek).sort();
  if (!weekKeys.length) return null;
  const thisWeekKey = weekKeys[weekKeys.length - 1];
  const thisWeek = byWeek[thisWeekKey];
  const dayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const labels = dayNames.map((name, i) => {
    const d = new Date(thisWeekKey + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return `${name} ${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;
  });
  const values = dayNames.map((_, i) => {
    const row = thisWeek[i];
    return row && row.tagesumsatzUsd !== null && row.tagesumsatzUsd !== undefined ? row.tagesumsatzUsd : null;
  });
  return { labels, values };
}

// Rendert den Tagesumsatz-Balken der aktuellen Woche als PNG (Apps-Script-
// Charts-Service, serverseitig - eine Email kann kein Chart.js ausfuehren) und
// liefert ihn als Blob fuer den Inline-Bild-Versand (inlineImages, kein Anhang -
// direkt sichtbar im Mailtext). Farben identisch zum Dashboard-Akzent (amber
// #FF8A1F), Hintergrund identisch zum dunklen CI-Kartenhintergrund der Mail.
function buildWeeklyChartBlob(daily) {
  const week = buildCurrentWeekDailyUsdGs(daily);
  if (!week) return null;
  const dataTable = Charts.newDataTable()
    .addColumn(Charts.ColumnType.STRING, "Tag")
    .addColumn(Charts.ColumnType.NUMBER, "USD");
  week.labels.forEach((label, i) => {
    const v = week.values[i];
    dataTable.addRow([label, v === null || v === undefined ? 0 : v]);
  });
  const chart = Charts.newColumnChart()
    .setDataTable(dataTable.build())
    .setDimensions(600, 260)
    .setColors([EMAIL_COLOR_TREND_UP])
    .setBackgroundColor(EMAIL_COLOR_CARD_BG)
    .setTitle("Tagesumsatz (diese Woche)")
    .setOption("titleTextStyle", { color: EMAIL_COLOR_TEXT, fontSize: 14 })
    .setOption("hAxis", { textStyle: { color: EMAIL_COLOR_MUTED } })
    .setOption("vAxis", { textStyle: { color: EMAIL_COLOR_MUTED }, gridlines: { color: EMAIL_COLOR_CARD_BORDER } })
    .setOption("legend", { position: "none" })
    .setOption("chartArea", { backgroundColor: EMAIL_COLOR_CARD_BG })
    .build();
  return chart.getAs("image/png").setName("wochenchart.png");
}

const GERMAN_MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

// Kompakter Betreff mit den wichtigsten Kennzahlen auf einen Blick, ohne die Mail
// oeffnen zu muessen (Nutzer-Anforderung 21.08.2026, mit konkretem Beispiel:
// "🤑 11labs Auszahlung [261,12 €, Ø ~xx,xx €/Tag, August 758,68 €]"). Bewusst OHNE
// "Letzte Abrechnung"-Wortlaut (Nutzer-Anforderung) und ohne Jahresprognose (waere
// im Beispiel weggelassen worden - vermutlich wegen der Betreffzeilen-Laenge in der
// Inbox-Vorschau).
function buildCompactSubject(data, latest, previousWeekPayout) {
  const latestEur = latest ? latest.eur : null;
  // Ø EUR/Tag der LETZTEN Auszahlung: latest.avgPerDayEur ist immer null (siehe
  // computeSummary() - dort erst berechenbar, sobald die NAECHSTE Auszahlung
  // bekannt ist), deshalb hier direkt aus latest.eur / Tage-seit-Vorauszahlung
  // berechnet - dieselbe Formel wie computeSummary() fuer aeltere Wochen.
  let avgPerDayEur = null;
  if (latest && previousWeekPayout) {
    const days = Math.max(1, daysBetweenIso(previousWeekPayout.weekStart.slice(0, 10), latest.weekStart.slice(0, 10)));
    avgPerDayEur = round2(latest.eur / days);
  }
  // Monat konsistent zum selben Abrechnungstag-Anker wie data.thisMonthEur
  // (billingDayIso, siehe computeSummary()) - sonst koennte der Betreff kurz nach
  // Mitternacht schon den naechsten Monatsnamen zeigen, waehrend die Zahl noch den
  // alten Monat meint.
  const billingMonthIso = billingDayIso(data.readoutTimeWeekly);
  const monthName = GERMAN_MONTH_NAMES[Number(billingMonthIso.slice(5, 7)) - 1];
  const deNumberFmtSubject = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (n) => (n === null || n === undefined ? "—" : `${deNumberFmtSubject.format(Number(n))} €`);
  return `🤑 11labs Auszahlung [${fmt(latestEur)}, Ø ~${fmt(avgPerDayEur)}/Tag, ${monthName} ${fmt(data.thisMonthEur)}]`;
}

function sendWeeklyReportEmail() {
  const data = computeSummary();
  // Nutzer-Anforderung 20.08.2026: Wochenreport IMMER an diese Adresse - bewusst
  // fest verdrahtet statt ueber eine (evtl. nicht gesetzte) Script-Property, damit
  // der Versand nie stillschweigend an eine andere Adresse (z.B. den ausfuehrenden
  // Google-Account) geht. Keine sicherheitsrelevante Information (keine Geheimnisse,
  // keine Tokens) - unbedenklich im Code.
  const recipient = "info@thorsten-schmidt.de";
  const weekly = data.history.weekly || [];
  const latest = weekly.length ? weekly[weekly.length - 1] : null;
  const previousWeekPayout = weekly.length >= 2 ? weekly[weekly.length - 2] : null;
  const weekEurDelta = latest && previousWeekPayout ? latest.eur - previousWeekPayout.eur : null;

  // Nutzer-Feedback 20.08.2026 (2. Runde): "die Tausender Punkte fehlen" - toFixed()
  // liefert keine Tausendertrennzeichen, Intl.NumberFormat("de-DE", ...) dagegen
  // schon (identisch zu deNumberFmt im Dashboard, html-dashboard/index.html) und
  // erzeugt automatisch "1.234,56" statt "1234.56".
  const deNumberFmtGs = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtEurGs = (n) => (n === null || n === undefined ? "—" : `${deNumberFmtGs.format(Number(n))} €`);
  const fmtUsdGs = (n) => (n === null || n === undefined ? "—" : `${deNumberFmtGs.format(Number(n))} $`);
  const pctColor = (n) => (n === null || n === undefined ? EMAIL_COLOR_MUTED : n >= 0 ? EMAIL_COLOR_TREND_UP : EMAIL_COLOR_TREND_DOWN);
  // Nutzer-Feedback 21.08.2026: "— ggü. Vorwoche" unter der EUR-Abrechnung war leer/
  // falsch - data.thisWeekVsLastWeekPct vergleicht intern den USD-TAGESUMSATZ-Trend
  // (haeufig null), nicht die hier gezeigte EUR-AUSZAHLUNG. Stattdessen direkt aus den
  // Auszahlungszeilen (weekly[]) den echten +/- EUR-Betrag zur Vorwoche berechnen -
  // das ist immer verfuegbar, sobald es 2 Auszahlungen gibt, und exakt der Vergleich,
  // den das Feld tatsaechlich zeigen soll.
  const fmtEurDeltaGs = (n) => (n === null || n === undefined ? "—" : `${n >= 0 ? "▲ +" : "▼ −"}${deNumberFmtGs.format(Math.abs(n))} €`);

  const dailyHistory = data.history.daily || [];
  const monthProjectionUsd = computeMonthProjectionGs(dailyHistory, new Date().getFullYear(), new Date().getMonth() + 1);
  // Nutzer-Feedback 21.08.2026: "Prognose bis Monatsende muss in EUR umgerechnet
  // werden" - dieselbe Umrechnung wie ueberall sonst im Report (data.fxRateUsdEur),
  // damit die Monatsprognose direkt mit dem EUR-Ist-Wert darueber vergleichbar ist.
  const monthProjectionEur = data.fxRateUsdEur ? monthProjectionUsd * data.fxRateUsdEur : null;
  const yearProjectionEur = computeYearProjectionGs(data.thisYearEur);
  const weeklyChartBlob = buildWeeklyChartBlob(dailyHistory);

  const latestDateLabel = latest ? Utilities.formatDate(new Date(latest.weekStart), "Europe/Berlin", "dd.MM.yyyy") : "—";
  const kwLabel = latest ? `KW${isoWeekNumber(new Date(latest.weekStart))}` : "";

  const recentRowsHtml = [...weekly].slice(-5).reverse().map((w) => {
    const paid = w.status === "Paid";
    const statusLabel = paid ? "Ausgezahlt" : w.status === "Pending" ? "Ausstehend" : (w.status || "—");
    const statusColor = paid ? EMAIL_COLOR_SUCCESS : EMAIL_COLOR_PENDING;
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid ${EMAIL_COLOR_CARD_BORDER};font-family:${EMAIL_FONT_BODY};font-size:13px;color:${EMAIL_COLOR_TEXT};">${Utilities.formatDate(new Date(w.weekStart), "Europe/Berlin", "dd.MM.yyyy")}</td>
      <td style="padding:6px 10px;border-bottom:1px solid ${EMAIL_COLOR_CARD_BORDER};text-align:right;font-family:${EMAIL_FONT_NUM};font-size:13px;color:${EMAIL_COLOR_TEXT};">${fmtEurGs(w.eur)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid ${EMAIL_COLOR_CARD_BORDER};font-family:${EMAIL_FONT_BODY};font-size:13px;color:${statusColor};">${statusLabel}</td>
    </tr>`;
  }).join("");

  // Aufbau bewusst 1:1 an html-dashboard/index.html angelehnt (Dark-Mode-Variante,
  // siehe EMAIL_COLOR_* oben): dunkler CI-Hintergrund, Karten mit --card-border/
  // 10px-Radius (.card-Klasse) in Kartenblau, Logo+Titel zentriert wie im <header>,
  // Archivo fuer Zahlen/Ueberschriften, Inter fuer Fliesstext, IBM Plex Mono fuer
  // tabellarische Zahlen (.font-num).
  const html = `
  <div style="background:${EMAIL_COLOR_BG};padding:24px 16px;">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@700;800;900&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');
      /* Nutzer-Anforderung 20.08.2026 (2. Runde): "alles sinnvoll auch responsiv
         angeordnet" - auf schmalen Bildschirmen (Mail-App auf dem Handy) wird die
         3-Karten-Zeile von nebeneinander (33%) auf volle Breite untereinander
         gestapelt umgeschaltet. Wird von Gmail/Apple Mail auf iOS/Android
         unterstuetzt; Clients ohne Media-Query-Support (u.a. manche Outlook-
         Versionen) zeigen einfach das feste 3-Spalten-Layout, bleibt also nutzbar. */
      @media (max-width: 480px) {
        .stack-cell { display: block !important; width: 100% !important; padding: 0 0 8px 0 !important; }
        .email-container { padding: 0 4px !important; }
        .week-chart-img { width: 100% !important; height: auto !important; }
      }
    </style>
    <div class="email-container" style="max-width:600px;margin:0 auto;font-family:${EMAIL_FONT_BODY};color:${EMAIL_COLOR_TEXT};">

      <div style="text-align:center;padding-bottom:16px;">
        <img src="${EMAIL_LOGO_DATA_URI}" width="50" height="50" alt="Logo" style="display:block;margin:0 auto 4px;border-radius:8px;" />
        <p style="margin:0;font-family:${EMAIL_FONT_DISPLAY};font-weight:900;font-size:18px;line-height:1.2;color:${EMAIL_COLOR_TEXT};">ElevenLabs Einnahmen</p>
        <p style="margin:2px 0 0;font-size:12px;font-weight:500;color:${EMAIL_COLOR_MUTED};">Abschlussbericht vom ${latestDateLabel}</p>
      </div>

      <div style="background:${EMAIL_COLOR_CARD_BG};border:1px solid ${EMAIL_COLOR_CARD_BORDER};border-radius:10px;padding:16px;text-align:center;margin-bottom:12px;">
        <p style="margin:0 0 2px;font-size:12px;font-weight:500;color:${EMAIL_COLOR_MUTED};">Letzte Abrechnung (EUR)</p>
        <p style="margin:0;font-family:${EMAIL_FONT_DISPLAY};font-weight:900;font-size:30px;line-height:1.2;color:${EMAIL_COLOR_TEXT};">${fmtEurGs(latest ? latest.eur : null)}</p>
        <p style="margin:4px 0 0;font-family:${EMAIL_FONT_NUM};font-size:13px;color:${pctColor(weekEurDelta)};">${fmtEurDeltaGs(weekEurDelta)} ggü. Vorwoche</p>
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
        <tr>
          <td class="stack-cell" width="33.33%" style="padding:0 4px 0 0;">
            <div style="background:${EMAIL_COLOR_CARD_BG};border:1px solid ${EMAIL_COLOR_CARD_BORDER};border-radius:10px;padding:10px;text-align:center;">
              <p style="margin:0 0 2px;font-size:11px;font-weight:500;color:${EMAIL_COLOR_MUTED};">Diese Woche (USD)</p>
              <p style="margin:0;font-family:${EMAIL_FONT_NUM};font-weight:700;font-size:15px;color:${EMAIL_COLOR_TEXT};">${fmtUsdGs(data.thisWeekUsdNet)}</p>
              ${data.weekStartBalanceUsd ? `<p style="margin:3px 0 0;font-family:${EMAIL_FONT_NUM};font-size:10px;color:${EMAIL_COLOR_MUTED};">+ Startwert ${fmtUsdGs(data.weekStartBalanceUsd)}</p>` : ""}
            </div>
          </td>
          <td class="stack-cell" width="33.33%" style="padding:0 4px;">
            <div style="background:${EMAIL_COLOR_CARD_BG};border:1px solid ${EMAIL_COLOR_CARD_BORDER};border-radius:10px;padding:10px;text-align:center;">
              <p style="margin:0 0 2px;font-size:11px;font-weight:500;color:${EMAIL_COLOR_MUTED};">Ø pro Tag</p>
              <p style="margin:0;font-family:${EMAIL_FONT_NUM};font-weight:700;font-size:15px;color:${EMAIL_COLOR_TEXT};">${fmtUsdGs(data.avgDailyUsd)}</p>
            </div>
          </td>
          <td class="stack-cell" width="33.33%" style="padding:0 0 0 4px;">
            <div style="background:${EMAIL_COLOR_CARD_BG};border:1px solid ${EMAIL_COLOR_CARD_BORDER};border-radius:10px;padding:10px;text-align:center;">
              <p style="margin:0 0 2px;font-size:11px;font-weight:500;color:${EMAIL_COLOR_MUTED};">Kurs USD→EUR</p>
              <p style="margin:0;font-family:${EMAIL_FONT_NUM};font-weight:700;font-size:15px;color:${EMAIL_COLOR_TEXT};">${data.fxRateUsdEur ? data.fxRateUsdEur.toFixed(4) : "—"}</p>
            </div>
          </td>
        </tr>
      </table>

      ${weeklyChartBlob ? `<div style="background:${EMAIL_COLOR_CARD_BG};border:1px solid ${EMAIL_COLOR_CARD_BORDER};border-radius:10px;padding:12px;margin-bottom:12px;text-align:center;">
        <img src="cid:weeklyChart" alt="Tagesumsatz diese Woche" class="week-chart-img" width="576" style="display:block;width:100%;max-width:576px;height:auto;margin:0 auto;border-radius:6px;" />
      </div>` : ""}

      <div style="background:${EMAIL_COLOR_CARD_BG};border:1px solid ${EMAIL_COLOR_CARD_BORDER};border-radius:10px;padding:4px 16px;margin-bottom:12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:10px 0;border-top:1px solid ${EMAIL_COLOR_CARD_BORDER};">
              <span style="font-size:13px;color:${EMAIL_COLOR_MUTED};">Dieser Monat (EUR)</span><br>
              <span style="font-family:${EMAIL_FONT_NUM};font-size:16px;font-weight:700;color:${EMAIL_COLOR_TEXT};">${fmtEurGs(data.thisMonthEur)}</span>
              <span style="font-family:${EMAIL_FONT_NUM};font-size:12px;color:${EMAIL_COLOR_MUTED};"> (Vormonat: ${fmtEurGs(data.lastMonthEur)})</span><br>
              <span style="font-family:${EMAIL_FONT_NUM};font-size:12px;color:${EMAIL_COLOR_TREND_UP};">Prognose bis Monatsende: ~${fmtEurGs(monthProjectionEur)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid ${EMAIL_COLOR_CARD_BORDER};">
              <span style="font-size:13px;color:${EMAIL_COLOR_MUTED};">Dieses Jahr (EUR)</span><br>
              <span style="font-family:${EMAIL_FONT_NUM};font-size:16px;font-weight:700;color:${EMAIL_COLOR_TEXT};">${fmtEurGs(data.thisYearEur)}</span>
              <span style="font-family:${EMAIL_FONT_NUM};font-size:12px;color:${EMAIL_COLOR_MUTED};"> (Vorjahr bis hierhin: ${fmtEurGs(data.lastYearEurSamePeriod)})</span><br>
              <span style="font-family:${EMAIL_FONT_NUM};font-size:12px;color:${EMAIL_COLOR_TREND_UP};">Prognose Jahresende: ~${fmtEurGs(yearProjectionEur)}</span>
            </td>
          </tr>
        </table>
      </div>

      <div style="background:${EMAIL_COLOR_CARD_BG};border:1px solid ${EMAIL_COLOR_CARD_BORDER};border-radius:10px;padding:14px 16px;">
        <p style="font-family:${EMAIL_FONT_DISPLAY};font-size:14px;font-weight:800;color:${EMAIL_COLOR_TEXT};margin:0 0 8px;">Letzte Auszahlungen</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead>
            <tr style="text-align:left;">
              <th style="padding:6px 10px 6px 0;font-family:${EMAIL_FONT_BODY};font-size:11px;font-weight:600;color:${EMAIL_COLOR_MUTED};">Woche ab</th>
              <th style="padding:6px 10px;font-family:${EMAIL_FONT_BODY};font-size:11px;font-weight:600;color:${EMAIL_COLOR_MUTED};text-align:right;">EUR</th>
              <th style="padding:6px 0 6px 10px;font-family:${EMAIL_FONT_BODY};font-size:11px;font-weight:600;color:${EMAIL_COLOR_MUTED};">Status</th>
            </tr>
          </thead>
          <tbody>${recentRowsHtml}</tbody>
        </table>
      </div>

      <p style="font-size:11px;color:${EMAIL_COLOR_MUTED};margin:16px 0 0;text-align:center;">Automatischer Wochenreport · Letzter Datenpunkt: ${data.lastUpdated ? Utilities.formatDate(new Date(data.lastUpdated), "Europe/Berlin", "dd.MM.yyyy, HH:mm") : "—"}</p>
    </div>
  </div>`;

  const mailOptions = {
    to: recipient,
    // Nutzer-Anforderung 21.08.2026 (2. Runde): kompakter Kennzahlen-Betreff statt
    // Datumsangabe - siehe buildCompactSubject() oben fuer die genaue Herleitung.
    subject: buildCompactSubject(data, latest, previousWeekPayout),
    htmlBody: html,
  };
  if (weeklyChartBlob) {
    mailOptions.inlineImages = { weeklyChart: weeklyChartBlob };
  }
  MailApp.sendEmail(mailOptions);
}

// Prueft bei jedem Trigger-Tick, ob seit dem letzten Mailversand ein NEUER
// woechentlicher Rollover stattgefunden hat (status.readoutTimeWeekly hat sich
// geaendert) - falls ja, sofort den Report verschicken. Nutzer-Anforderung
// 21.08.2026: "nicht Montagmorgen 08:00 Uhr, sondern exakt unmittelbar nach dem
// von ElevenLabs selbst gewaehlten Zeitpunkt der Abrechnung" - der Rollover-
// Zeitpunkt ist nicht fest (aktuell z.B. dienstags ~11:59, kann variieren), daher
// kein fester Wochentag/Uhrzeit-Trigger mehr moeglich, sondern Erkennung ueber den
// zuletzt bekannten Status. PropertiesService speichert die zuletzt vermailte
// Ablesezeit dauerhaft (ueberlebt Skript-Neustarts), damit kein doppelter Versand
// bei mehreren Trigger-Ticks derselben Woche passiert.
function maybeSendWeeklyReportEmail() {
  const status = readStatus(SpreadsheetApp.getActiveSpreadsheet());
  const readout = status.readoutTimeWeekly;
  if (!readout) return; // noch kein einziger Collector-Lauf bekannt
  const props = PropertiesService.getScriptProperties();
  const lastEmailed = props.getProperty("LAST_EMAILED_READOUT_TIME") || "";
  if (readout === lastEmailed) return; // fuer diesen Rollover wurde bereits verschickt
  sendWeeklyReportEmail();
  props.setProperty("LAST_EMAILED_READOUT_TIME", readout);
}

// EINMALIG von Hand ausfuehren (Apps-Script-Editor: Funktion "setupWeeklyReportTrigger"
// im Dropdown auswaehlen, "Ausfuehren" klicken - siehe apps-script/README.md fuer die
// genaue Klickfolge). Richtet den Rollover-Erkennungs-Trigger ein (alle 15 Minuten,
// getaktet wie der Collector - siehe .github/workflows/collect.yml - damit ein
// frischer Rollover zeitnah erkannt wird). Entfernt zuvor einen evtl. schon
// bestehenden Trigger (Idempotenz - kein doppelter Trigger, falls die Funktion
// mehrfach ausgefuehrt wird).
function setupWeeklyReportTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === "sendWeeklyReportEmail" || t.getHandlerFunction() === "maybeSendWeeklyReportEmail") {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger("maybeSendWeeklyReportEmail")
    .timeBased()
    .everyMinutes(15)
    .create();
  // Aktuelle Ablesezeit als Startmarke setzen, damit beim Einrichten NICHT sofort
  // eine Mail verschickt wird (das waere ja kein echter Rollover), sondern erst
  // beim naechsten tatsaechlichen woechentlichen Wechsel.
  const status = readStatus(SpreadsheetApp.getActiveSpreadsheet());
  if (status.readoutTimeWeekly) {
    PropertiesService.getScriptProperties().setProperty("LAST_EMAILED_READOUT_TIME", status.readoutTimeWeekly);
  }
  Logger.log("Rollover-Erkennungs-Trigger eingerichtet: prueft alle 15 Minuten, verschickt sofort bei neuem woechentlichem Rollover.");
}

// ============================================================================
// Branchennews (Nutzer-Anforderung 20.08.2026: "Ereignisse im Markt, die das
// Geschaeft AUDIO, KI, ChatBot, digitale KI Audioentwicklung ... betreffen ...
// sinnvoll optisch hier einfliessen"). Sammelt taeglich per RSS aus kuratierten
// Branchenquellen, schreibt neue (noch nicht bekannte) Artikel in einen eigenen
// Sheet-Tab "IndustryNews" - die Datenbruecke liefert sie dann im JSON-Payload
// (Feld industryNews), das Dashboard zeigt sie als Info-Punkte im "Gesamt"-Chart
// (siehe computeNewsHints() in index.html). Bewusst KEINE automatische Kausalitaets-
// Behauptung ("das war die Ursache") - nur Kontext zum selbst Einordnen, siehe
// Erklaerung im Chat vom 20.08.2026 (bei wenigen Datenpunkten pro Woche waere eine
// automatische Korrelationsaussage nicht seriös).
//
// Voicebot.ai und Synthedia sind bereits eng auf Voice-/Audio-KI fokussiert (kein
// Stichwort-Filter noetig, jeder Artikel ist relevant). TechCrunch/VentureBeat AI
// sind breiter (alle KI-Themen) - dort filterKeywords, damit nur wirklich
// einschlaegige Artikel landen und der Chart nicht mit generischen KI-News zugemuellt
// wird. Liste laufend pflegen/erweitern, falls neue relevante Quellen dazukommen.
// ============================================================================
const NEWS_RSS_FEEDS = [
  { name: "Voicebot.ai", url: "https://voicebot.ai/feed/", filterKeywords: null },
  { name: "Synthedia", url: "https://synthedia.substack.com/feed", filterKeywords: null },
  {
    name: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    filterKeywords: ["voice", "audio", "speech", "elevenlabs", "chatbot", "text-to-speech", "tts", "podcast"],
  },
  {
    name: "VentureBeat AI",
    url: "https://venturebeat.com/category/ai/feed/",
    filterKeywords: ["voice", "audio", "speech", "elevenlabs", "chatbot", "text-to-speech", "tts", "podcast"],
  },
];
const NEWS_MAX_ITEMS_PER_FEED = 8;

// Minimaler RSS-2.0-Parser (title/link/pubDate je <item>) ueber XmlService -
// alle vier obigen Feeds liefern Standard-RSS-2.0, daher reicht dieser eine
// Parser (kein Atom-Support noetig).
function parseRssFeed(xmlText, sourceName) {
  const items = [];
  try {
    const doc = XmlService.parse(xmlText);
    const channel = doc.getRootElement().getChild("channel");
    if (!channel) return items;
    channel.getChildren("item").forEach((item) => {
      const title = (item.getChildText("title") || "").trim();
      const link = (item.getChildText("link") || "").trim();
      const pubDateRaw = item.getChildText("pubDate") || "";
      const pubDate = pubDateRaw ? new Date(pubDateRaw) : new Date();
      if (title && link) items.push({ title, link, pubDate, source: sourceName });
    });
  } catch (e) {
    Logger.log(`RSS-Parse-Fehler (${sourceName}): ${e}`);
  }
  return items;
}

// Taeglich per Trigger (siehe setupIndustryNewsTrigger unten): ruft alle
// NEWS_RSS_FEEDS ab, filtert nach Stichwoertern (falls konfiguriert) und haengt
// nur wirklich NEUE Artikel an (Dedupe ueber den Link) - kein doppelter Eintrag
// bei jedem taeglichen Lauf.
// Uebersetzt einen Artikel-Titel per Apps Script LanguageApp (eingebauter Dienst,
// kein extra Secret/API-Key noetig) von Englisch nach Deutsch - alle vier Quellen
// sind englischsprachig, das Dashboard ist aber komplett auf Deutsch (Nutzer-
// Anforderung 20.08.2026: "News aus der Branche muessen auf Deutsch uebersetzt
// werden"). Faellt bei Fehlern auf den Original-Titel zurueck statt die ganze
// Sammlung abzubrechen.
function translateToGerman(text) {
  try {
    return LanguageApp.translate(text, "en", "de");
  } catch (e) {
    Logger.log(`Uebersetzung fehlgeschlagen ("${text}"): ${e}`);
    return text;
  }
}

function fetchIndustryNews() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("IndustryNews");
  if (!sheet) {
    sheet = ss.insertSheet("IndustryNews");
    sheet.appendRow(["Datum", "Titel (DE)", "Titel (Original)", "Link", "Quelle"]);
  }
  const existingLinks = new Set(sheet.getDataRange().getValues().slice(1).map((r) => r[3]));
  const newRows = [];
  NEWS_RSS_FEEDS.forEach((feed) => {
    let xml;
    try {
      const response = UrlFetchApp.fetch(feed.url, { muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) {
        Logger.log(`RSS-Abruf fehlgeschlagen (${feed.name}): HTTP ${response.getResponseCode()}`);
        return;
      }
      xml = response.getContentText();
    } catch (e) {
      Logger.log(`RSS-Abruf-Fehler (${feed.name}): ${e}`);
      return;
    }
    const items = parseRssFeed(xml, feed.name).slice(0, NEWS_MAX_ITEMS_PER_FEED);
    items.forEach((it) => {
      if (existingLinks.has(it.link)) return;
      if (feed.filterKeywords) {
        const lowerTitle = it.title.toLowerCase();
        if (!feed.filterKeywords.some((kw) => lowerTitle.includes(kw))) return;
      }
      newRows.push([it.pubDate, translateToGerman(it.title), it.title, it.link, it.source]);
      existingLinks.add(it.link);
    });
  });
  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 5).setValues(newRows);
  }
  Logger.log(`Branchennews: ${newRows.length} neue Artikel hinzugefuegt.`);
}

// Liest den "IndustryNews"-Tab fuer den JSON-Payload - neueste zuerst, auf 200
// Eintraege gedeckelt (mehr braucht das Dashboard nicht). Liefert den deutschen
// Titel (Spalte 2); der englische Original-Titel bleibt nur im Sheet als Referenz,
// falls die Uebersetzung mal daneben liegt.
function readIndustryNews(ss) {
  const sheet = ss.getSheetByName("IndustryNews");
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows
    .map((r) => ({
      date: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      title: r[1],
      link: r[3],
      source: r[4],
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 200);
}

// EINMALIG von Hand ausfuehren (wie setupWeeklyReportTrigger oben) - richtet den
// taeglichen Branchennews-Abruf ein. Braucht KEINE neue Google-Berechtigung (nutzt
// dieselben bereits erteilten Scopes fuer UrlFetchApp/ScriptApp/SpreadsheetApp).
function setupIndustryNewsTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === "fetchIndustryNews") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("fetchIndustryNews").timeBased().everyDays(1).atHour(6).create();
  Logger.log("Taeglicher Branchennews-Trigger eingerichtet (ca. 6 Uhr).");
  fetchIndustryNews(); // Direkt einen ersten Durchlauf ausfuehren statt bis morgen zu warten.
}

// EINMALIG von Hand ausfuehren (Nutzer-Anfrage 20.08.2026): der taegliche RSS-
// Trigger oben sammelt nur NEUE Artikel ab dem Tag seiner Einrichtung - die
// Feeds selbst haben kein Archiv fuer 2025. Damit die violetten News-Punkte im
// "Gesamt"-Chart auch rueckwirkend zur Verfuegung stehen (um von Hand zu prüfen,
// ob sich grosse Branchen-Ereignisse im eigenen Kurvenverlauf wiederfinden - siehe
// Kommentar bei NEWS_RSS_FEEDS: bewusst keine automatische Kausalitaetsbehauptung),
// hier eine von Hand recherchierte, mit echten Quellen belegte Auswahl groesserer
// Ereignisse aus der Audio-/Voice-KI-Branche seit Beginn der Datenreihe (Feb 2025).
// Tage ohne exakt bekanntes Datum (Quelle nennt nur den Monat) sind auf den 1./15.
// gesetzt - fuer die wochenweise Zuordnung im Chart reicht das, siehe readIndustryNews().
// Dedupliziert wie fetchIndustryNews() ueber den Link, daher gefahrlos mehrfach
// ausfuehrbar.
function backfillHistoricalIndustryNews() {
  const HISTORICAL_NEWS = [
    {
      date: "2025-02-10",
      titleDe: "ElevenLabs startet Scribe (Speech-to-Text) und Audiobook-Partnerschaft mit Spotify",
      titleOrig: "ElevenLabs launches Scribe speech-to-text model; Spotify partners for AI-narrated audiobooks in 29 languages",
      link: "https://thursdai.news/companies/elevenlabs",
      source: "ElevenLabs-Timeline (ThursdAI)",
    },
    {
      date: "2025-06-15",
      titleDe: "Eleven v3 Alpha: ausdrucksstärkere Sprache, 41 neue Sprachen, Conversational AI",
      titleOrig: "ElevenLabs releases Eleven v3 Alpha with expressive speech, 41 new languages, and Conversational AI",
      link: "https://thursdai.news/companies/elevenlabs#v3-alpha",
      source: "ElevenLabs-Timeline (ThursdAI)",
    },
    {
      date: "2025-08-05",
      titleDe: "ElevenLabs startet KI-Musikgenerator für kommerzielle Nutzung",
      titleOrig: "ElevenLabs launches an AI music generator, which it claims is cleared for commercial use",
      link: "https://techcrunch.com/2025/08/05/elevenlabs-launches-an-ai-music-generator-which-it-claims-is-cleared-for-commercial-use/",
      source: "TechCrunch",
    },
    {
      date: "2025-11-11",
      titleDe: "ElevenLabs Summit: Hollywood-Partnerschaften (Michael Caine, Matthew McConaughey) und Iconic Marketplace",
      titleOrig: "ElevenLabs Launches Advanced Capabilities for Enterprise AI Agents at Inaugural Summit",
      link: "https://www.businesswire.com/news/home/20251111167214/en/ElevenLabs-Launches-Advanced-Capabilities-for-Enterprise-AI-Agents-at-Inaugural-Summit",
      source: "BusinessWire",
    },
    {
      date: "2026-02-04",
      titleDe: "ElevenLabs sammelt 500 Mio. $ Series D bei 11 Mrd. $ Bewertung ein",
      titleOrig: "Nvidia-backed AI voice startup ElevenLabs hits $11 billion valuation in fresh fundraise, as it eyes IPO",
      link: "https://www.cnbc.com/2026/02/04/nvidia-backed-ai-startup-elevenlabs-11-billion-valuation.html",
      source: "CNBC",
    },
    {
      date: "2026-04-15",
      titleDe: "ElevenLabs erreicht 500 Mio. $ Jahresumsatz (ARR), von 350 Mio. $ Ende 2025",
      titleOrig: "ElevenLabs hits $500M in ARR, up from $350M at the end of 2025",
      link: "https://texttolab.com/blog/elevenlabs-news",
      source: "TextToLab",
    },
    {
      date: "2026-05-01",
      titleDe: "ElevenReader wird vollwertige Hörbuch-Plattform (200.000 Titel), Spotify-Partnerschaft erweitert",
      titleOrig: "ElevenReader becomes a full audiobook platform with 200,000 human-narrated titles; Spotify partnership expands for author-published AI audiobooks",
      link: "https://texttolab.com/blog/elevenlabs-news#elevenreader",
      source: "TextToLab",
    },
    {
      date: "2026-05-10",
      titleDe: "OpenAI übernimmt Voice-Cloning-Startup Weights.gg",
      titleOrig: "OpenAI quietly acquires AI voice cloning startup Weights.gg",
      link: "https://www.biometricupdate.com/202605/openai-quietly-acquires-ai-voice-cloning-startup-weights-gg",
      source: "Biometric Update",
    },
    {
      date: "2026-06-01",
      titleDe: "Sammelklagen (BIPA) gegen ElevenLabs und weitere Tech-Konzerne wegen KI-Stimmtraining ohne Zustimmung",
      titleOrig: "Biometric privacy lawsuits filed against ElevenLabs, Google, Amazon, Meta and others over AI voice training without consent",
      link: "https://texttolab.com/blog/elevenlabs-news#bipa",
      source: "TextToLab",
    },
  ];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("IndustryNews");
  if (!sheet) {
    sheet = ss.insertSheet("IndustryNews");
    sheet.appendRow(["Datum", "Titel (DE)", "Titel (Original)", "Link", "Quelle"]);
  }
  const existingLinks = new Set(sheet.getDataRange().getValues().slice(1).map((r) => r[3]));
  const newRows = HISTORICAL_NEWS.filter((n) => !existingLinks.has(n.link)).map((n) => [
    new Date(n.date),
    n.titleDe,
    n.titleOrig,
    n.link,
    n.source,
  ]);
  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 5).setValues(newRows);
  }
  Logger.log(`Rueckwirkende Branchennews: ${newRows.length} neue Eintraege hinzugefuegt.`);
}
