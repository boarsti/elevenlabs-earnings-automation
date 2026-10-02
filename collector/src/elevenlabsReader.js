// Liest die ElevenLabs Voices-Earnings-Seite mit einer authentifizierten Session aus.
//
// Seitenstruktur (verifiziert 18.08.2026, Selektoren angepasst 01.10.2026):
//   Zwei Betrag-Karten (CSS p.text-sm.text-foreground.font-normal.tabular-nums.truncate):
//     Index 0  -> "$351.80 USD"   (Current Period / Aktueller Zeitraum)
//     Index 1  -> "€21099.39 EUR" (All Time Payouts / Auszahlungen insgesamt)
//   Tabelle <table>  -> Zeilen: Datum | Betrag | Einbehaltene Steuer | Waehrung | Status
//     Die laufende Woche erscheint als letzte Zeile mit Status "Pending"/"Ausstehend".
//     Seit ca. 01.10.2026 liefert ElevenLabs die Seite in der Kontosprache - deshalb
//     werden Selektoren auf CSS-Klassen statt auf englische Texte gestuetzt.

const PAYOUTS_URL = "https://elevenlabs.io/app/voices-earnings/payouts";

// ElevenLabs zeigt die Beträge (Current Period, All Time Payouts) in einem
// stabilen CSS-Element – unabhängig von der Oberflächensprache des Kontos
// (seit ca. 01.10.2026 kann die Seite in der Kontosprache erscheinen, z.B.
// Deutsch). Die Klasse bleibt konstant, Position [0]=USD, [1]=EUR.
const AMOUNT_SELECTOR = "p.text-sm.text-foreground.font-normal.tabular-nums.truncate";

export async function readEarnings(page) {
  await page.goto(PAYOUTS_URL, { waitUntil: "domcontentloaded" });

  // Auf Hydration + Firestore-Live-Werte warten (siehe Design-Doku: Werte kommen
  // client-seitig per Realtime-Listener, nicht im initialen HTML).
  // Sprachunabhaengig: warten auf den ersten Betrag-Container statt auf den
  // englischen Text "Current Period" (Bugfix 01.10.2026: ElevenLabs liefert
  // die Seite jetzt in der Kontosprache des eingeloggten Nutzers).
  await page.locator(AMOUNT_SELECTOR).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3_000); // kurze Karenz, bis der Listener den echten Wert liefert

  const currentPeriod = await readAmountByIndex(page, 0); // [0] = Current Period (USD)
  const allTimePayouts = await readAmountByIndex(page, 1); // [1] = All Time Payouts (EUR)
  const history = await readHistoryTable(page);

  return { currentPeriod, allTimePayouts, history, scrapedAt: new Date().toISOString() };
}

async function readAmountByIndex(page, index) {
  const text = await page.locator(AMOUNT_SELECTOR).nth(index).innerText();
  return parseAmount(text);
}

// Parst z.B. "$78.79 USD" oder "€19133.13 EUR" -> { amount: 78.79, currency: "USD" }
function parseAmount(text) {
  const match = text.match(/([$€])\s*([\d.,]+)\s*([A-Z]{3})?/);
  if (!match) {
    throw new Error(`Konnte Betrag nicht aus Text extrahieren: "${text}"`);
  }
  const [, symbol, rawNumber, currencyWord] = match;
  const amount = Number(rawNumber.replace(/,/g, ""));
  const currency = currencyWord || (symbol === "$" ? "USD" : "EUR");
  return { amount, currency };
}

async function readHistoryTable(page) {
  const table = page.locator("table").first();
  await table.waitFor({ timeout: 15_000 });

  // Primärer Weg: echte <tr>/<td>-Struktur.
  const rows = await table.evaluate((tableEl) => {
    const trs = Array.from(tableEl.querySelectorAll("tr"));
    return trs
      .map((tr) => Array.from(tr.querySelectorAll("td,th")).map((c) => c.textContent.trim()))
      .filter((cells) => cells.length >= 5);
  });

  // Header-Zeile verwerfen (EN: "Date", DE: "Datum") - sprachunabhängig.
  const dataRows = rows.filter((cells) => cells[0] !== "Date" && cells[0] !== "Datum");

  return dataRows.map(([date, amount, taxWithheld, currency, status]) => ({
    date,
    dateIso: parseElevenLabsDate(date),
    amount: parseAmount(amount).amount,
    taxWithheld: parseAmount(taxWithheld).amount,
    currency: currency?.toLowerCase(),
    status, // "Paid" | "Pending"
  }));
}

// Parst ElevenLabs' History-Datumsformat "8/18/26, 11:59" (M/D/YY, HH:mm, 24h).
//
// WICHTIG (Bugfix 18.08.2026, zweiter Fund): Der Browser-Kontext wird in collect.js
// explizit auf die Zeitzone "Europe/Berlin" gepinnt (siehe dort), d.h. ElevenLabs
// rendert diese Uhrzeit IMMER in deutscher Ortszeit - unabhaengig davon, ob der
// Collector auf GitHub Actions (Systemzeit UTC) oder lokal (Systemzeit z.B. CEST)
// laeuft. Der erste Versuch hat die Zeichenkette faelschlich mit der AMBIENTEN
// System-Zeitzone von Node.js interpretiert (auf GitHub Actions also als UTC statt
// als deutsche Ortszeit) - das ergab einen 1-2h-Versatz. Diese Funktion rechnet
// "Europe/Berlin"-Ortszeit jetzt explizit und zeitzonen-unabhaengig in UTC um.
function parseElevenLabsDate(text) {
  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2}),\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, m, d, yy, hh, min] = match;
  const year = 2000 + Number(yy);
  return zonedWallTimeToUtcIso(year, Number(m), Number(d), Number(hh), Number(min), "Europe/Berlin");
}

// Wandelt eine "Wanduhr"-Zeit (z.B. "18.08.2026 11:59 in Europe/Berlin") in einen
// korrekten UTC-ISO-Zeitstempel um - ohne externe Zeitzonen-Bibliothek, per
// Iterations-Trick ueber Intl.DateTimeFormat (funktioniert unabhaengig von der
// System-Zeitzone des ausfuehrenden Rechners/Runners).
function zonedWallTimeToUtcIso(year, month, day, hour, minute, timeZone) {
  let guessUtc = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i++) {
    const rendered = formatInTimeZone(new Date(guessUtc), timeZone);
    const diffMs = Date.UTC(year, month - 1, day, hour, minute) - Date.UTC(
      rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute
    );
    guessUtc += diffMs;
  }
  return new Date(guessUtc).toISOString();
}

function formatInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}
