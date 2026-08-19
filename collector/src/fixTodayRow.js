// EINMALIGER Reparatur-Lauf (nicht Teil des Workflows): korrigiert die heutige
// Zeile, deren Ablesezeit/Anfangsguthaben durch den in collect.js behobenen Bug
// versehentlich auf leer zurückgesetzt wurden.
import { getAuthedSheets, ensureTabs, readDailyRows, upsertDailyRow } from "./sheetsClient.js";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const TODAY = process.argv[2];
const ABLESEZEIT_ISO = process.argv[3];
const ANFANGSGUTHABEN = Number(process.argv[4]);

async function main() {
  const sheets = await getAuthedSheets();
  await ensureTabs(sheets, SPREADSHEET_ID);
  const rows = await readDailyRows(sheets, SPREADSHEET_ID);
  const row = rows.find((r) => r.Datum === TODAY);
  if (!row) throw new Error(`Keine Zeile fuer ${TODAY} gefunden.`);
  await upsertDailyRow(sheets, SPREADSHEET_ID, {
    ...row,
    Ablesezeit: ABLESEZEIT_ISO,
    Anfangsguthaben_USD: ANFANGSGUTHABEN,
  });
  console.log(`OK: ${TODAY} korrigiert - Ablesezeit=${ABLESEZEIT_ISO}, Anfangsguthaben=${ANFANGSGUTHABEN}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
