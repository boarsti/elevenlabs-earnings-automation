// Einmaliger, interaktiver Login-Lauf.
// Öffnet einen echten (sichtbaren) Browser, du loggst dich manuell bei ElevenLabs ein
// (inkl. eventueller 2FA), danach wird die Session (Cookies + LocalStorage inkl.
// Firebase-Auth) lokal gespeichert. Diese Datei NIEMALS committen (siehe .gitignore).
//
// Aufruf:  npm run login

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.resolve(__dirname, "..", "storageState.json");

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://elevenlabs.io/app/voices-earnings/payouts");

  console.log("\nBitte im geöffneten Browser-Fenster bei ElevenLabs einloggen.");
  console.log("Warte, bis die Payouts-Seite mit 'Current Period' sichtbar ist,");
  console.log("dann hier im Terminal einfach ENTER drücken.\n");

  await waitForEnter();

  await context.storageState({ path: STATE_PATH });
  console.log(`Session gespeichert unter: ${STATE_PATH}`);
  console.log("Diese Datei ist in .gitignore - wird NICHT committed.");
  console.log("Für GitHub Actions: Inhalt als Secret ELEVENLABS_STORAGE_STATE hinterlegen (siehe README).");

  await browser.close();
}

function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

main().catch((err) => {
  console.error("Login-Lauf fehlgeschlagen:", err);
  process.exit(1);
});
