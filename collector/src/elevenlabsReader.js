// Liest die ElevenLabs Voices-Earnings-Seite mit einer authentifizierten Session aus.
//
// Verifiziert per Live-Inspektion (18.08.2026) - die Seite zeigt (stabile Text-Anker):
//   "Current Period"      -> "$78.79 USD"           (laufender, kurzfristiger USD-Wert)
//   "All Time Payouts"    -> "€19133.13 EUR"
//   Tabelle "History"     -> Zeilen: Date | Amount | Tax Withheld | Currency | Status
//     Die JEWEILS AKTUELLE (laufende) Woche erscheint dort selbst als letzte Zeile
//     mit Status "Pending", z.B. "8/18/26, 11:59 | €261.12 | €0.00 | eur | Pending".
//     Das ist der Wert, der im Sheet manuell in Spalte J landet.

const PAYOUTS_URL = "https://elevenlabs.io/app/voices-earnings/payouts";

export async function readEarnings(page) {
  await page.goto(PAYOUTS_URL, { waitUntil: "domcontentloaded" });

  // Auf Hydration + Firestore-Live-Werte warten (siehe Design-Doku: Werte kommen
  // client-seitig per Realtime-Listener, nicht im initialen HTML).
  await page.getByText("Current Period", { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3_000); // kurze Karenz, bis der Listener den echten Wert liefert

  const currentPeriod = await readLabelledAmount(page, "Current Period");
  const allTimePayouts = await readLabelledAmount(page, "All Time Payouts");
  const history = await readHistoryTable(page);

  return { currentPeriod, allTimePayouts, history, scrapedAt: new Date().toISOString() };
}

async function readLabelledAmount(page, label) {
  const container = page.getByText(label, { exact: true }).locator("..");
  const text = await container.innerText();
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

  // Header-Zeile (Date/Amount/Tax Withheld/Currency/Status) verwerfen, falls vorhanden.
  const dataRows = rows.filter((cells) => cells[0] !== "Date");

  return dataRows.map(([date, amount, taxWithheld, currency, status]) => ({
    date,
    amount: parseAmount(amount).amount,
    taxWithheld: parseAmount(taxWithheld).amount,
    currency: currency?.toLowerCase(),
    status, // "Paid" | "Pending"
  }));
}
