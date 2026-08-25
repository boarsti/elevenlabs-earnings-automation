// Liest die ElevenLabs "Voices Earnings Analytics"-Seite aus (pro Stimme taeglicher
// Verdienst + Character-Verbrauch) - separat vom Haupt-Collector (elevenlabsReader.js
// liest nur den AGGREGAT-Payout, nicht die Aufschluesselung pro Stimme).
//
// Verifiziert per Live-Erkundung (25.08.2026):
//   https://elevenlabs.io/app/voices-earnings/analytics
//   - Ohne "voice_id"-Filter + "Group By: Voice" (Standard) zeigt die Seite ALLE
//     eigenen Stimmen gleichzeitig.
//   - Drei Tabs (Radix, "role=tab") schalten die geplottete/exportierte Kennzahl um:
//     "earnings_tab" (Total Earnings, USD), "character_usage_tab" (Character Usage).
//   - Ein Export-Button (aria-label="Export") oeffnet ein Menue mit "Export CSV" /
//     "Export PDF" - der CSV-Export liefert GENAU die Rohdaten hinter dem Chart:
//     Time,voice_id,voice_name,<Earnings|Characters> - eine Zeile pro Tag pro Stimme.
//     Das ist die einzige gefundene Quelle mit taggenauer Pro-Stimme-Aufschluesselung;
//     keine oeffentliche API dafuer vorhanden.
//   - Granularitaet-Dropdown des CHARTS schaltet zwar bei langen Zeitraeumen auf
//     "Weekly" um - der CSV-EXPORT bleibt davon aber unberuehrt und liefert weiterhin
//     eine Zeile pro Tag pro Stimme (verifiziert 25.08.2026 per "Last 3 years": 493
//     Zeilen mit echten Tagesdaten von 2025-01-30 bis heute, keine Wochen-Buckets).
//     Der frueher hier dokumentierte gegenteilige Verdacht war falsch - "Last 3 years"
//     ist daher fuer ein einmaliges Backfill sicher nutzbar, siehe range-Parameter.
//   - Ein Promo-Popup ("Platform switch has moved") kann kurzzeitig ueber dem
//     Export-Button liegen und Klicks abfangen - wird defensiv aus dem DOM entfernt.

const ANALYTICS_URL = "https://elevenlabs.io/app/voices-earnings/analytics";
const RANGE_LABELS = { "30d": "Last 30 days", "3y": "Last 3 years" };

// range: "30d" (Standard, taeglicher Lauf - rollierendes Fenster, upsert baut Historie
// inkrementell aus) oder "3y" (einmaliges Backfill - deckt die komplette bisher
// verfuegbare Kontohistorie ab, siehe collectVoiceEarnings.js VOICE_EARNINGS_RANGE).
export async function readVoiceEarnings(page, { range = "30d" } = {}) {
  await page.goto(ANALYTICS_URL, { waitUntil: "domcontentloaded" });
  await page.getByText("Total Earnings", { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);

  await setDateRange(page, range);

  const earningsRows = await exportTabAsRows(page, "earnings_tab", "Earnings");
  const characterRows = await exportTabAsRows(page, "character_usage_tab", "Characters");

  return mergeByDateAndVoice(earningsRows, characterRows);
}

async function setDateRange(page, range) {
  const label = RANGE_LABELS[range];
  if (!label) throw new Error(`Unbekannter Zeitraum "${range}" - erwartet: ${Object.keys(RANGE_LABELS).join(", ")}`);
  // Label ist z.B. "Last 7 days · UTC+2" als EIN Textknoten - ohne exact:true suchen.
  await page.getByText("Last 7 days").click();
  await page.waitForTimeout(200);
  await page.getByText(label, { exact: true }).click();
  await page.waitForTimeout(500);
}

async function removeInterferingPromo(page) {
  await page.evaluate(() => {
    document.querySelectorAll("[data-radix-popper-content-wrapper]").forEach((el) => {
      if (el.textContent.includes("Platform switch has moved")) el.remove();
    });
  });
}

async function exportTabAsRows(page, tabId, valueColumnName) {
  await page.locator(`[role="tab"][aria-controls$="-content-${tabId}"]`).click();
  await page.waitForTimeout(300);
  await removeInterferingPromo(page);

  const exportBtn = page.locator('button[aria-label="Export"]');
  await exportBtn.click();
  await page.waitForTimeout(300);
  const expanded = await exportBtn.getAttribute("aria-expanded");
  if (expanded !== "true") {
    throw new Error(`Export-Menü (${tabId}) hat sich nicht geöffnet - ElevenLabs-UI evtl. geändert.`);
  }

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByText("Export CSV", { exact: true }).click(),
  ]);
  const stream = await download.createReadStream();
  const csv = await streamToString(stream);
  return parseCsv(csv, valueColumnName);
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

// Sehr einfacher CSV-Parser, ausreichend fuer dieses Format (durchgaengig gequotete
// Felder, keine eingebetteten Kommas/Anfuehrungszeichen in den Werten selbst -
// ausser im Stimmennamen, der Kommas enthalten KANN, z.B. "Alexander - for
// audiobook, news, magazines, descriptions" - daher regex statt naivem split(",")).
function parseCsv(csv, valueColumnName) {
  const lines = csv.trim().split("\n").filter(Boolean);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].match(/(?:"([^"]*)")(?:,|$)/g);
    if (!fields || fields.length < 4) continue;
    const clean = fields.map((f) => f.replace(/^"|"?,?$/g, ""));
    const [time, voiceId, voiceName, value] = clean;
    rows.push({
      date: time.slice(0, 10), // "2026-08-19T00:00:00+0200" -> "2026-08-19"
      voiceId,
      voiceName,
      [valueColumnName]: Number(value) || 0,
    });
  }
  return rows;
}

function mergeByDateAndVoice(earningsRows, characterRows) {
  const byKey = new Map();
  earningsRows.forEach((r) => {
    byKey.set(`${r.date}|${r.voiceId}`, { date: r.date, voiceId: r.voiceId, voiceName: r.voiceName, Earnings: r.Earnings, Characters: 0 });
  });
  characterRows.forEach((r) => {
    const key = `${r.date}|${r.voiceId}`;
    const existing = byKey.get(key);
    if (existing) existing.Characters = r.Characters;
    else byKey.set(key, { date: r.date, voiceId: r.voiceId, voiceName: r.voiceName, Earnings: 0, Characters: r.Characters });
  });
  return [...byKey.values()];
}
