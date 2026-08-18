// Einmaliger, interaktiver Login-Lauf.
// Öffnet einen echten (sichtbaren) Browser, du loggst dich manuell bei ElevenLabs ein
// (inkl. eventueller 2FA), danach wird die Session (Cookies + LocalStorage inkl.
// Firebase-Auth) lokal gespeichert. Diese Datei NIEMALS committen (siehe .gitignore).
//
// Aufruf:  npm run login

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.resolve(__dirname, "..", "storageState.json");

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://elevenlabs.io/app/voices-earnings/payouts");

  console.log("\nBitte im geöffneten Browser-Fenster bei ElevenLabs einloggen.");
  console.log("Das Skript erkennt automatisch, wenn die Payouts-Seite mit 'Current Period'");
  console.log("sichtbar ist, und speichert dann die Session (Timeout: 10 Minuten).\n");

  await page.getByText("Current Period", { exact: true }).waitFor({ timeout: 10 * 60 * 1000 });
  await page.waitForTimeout(2_000); // kurze Karenz, bis alles vollstaendig geladen ist

  const state = await context.storageState();
  stripAnalyticsBloat(state);
  fs.writeFileSync(STATE_PATH, JSON.stringify(state));

  const sizeKb = (fs.statSync(STATE_PATH).size / 1024).toFixed(1);
  console.log(`Session gespeichert unter: ${STATE_PATH} (${sizeKb} KB)`);
  if (sizeKb > 48) {
    console.warn(
      "WARNUNG: Datei > 48 KB - GitHub Actions Secrets erlauben das nicht. Bitte pruefen."
    );
  }
  console.log("Diese Datei ist in .gitignore - wird NICHT committed.");
  console.log("Für GitHub Actions: Inhalt als Secret ELEVENLABS_STORAGE_STATE hinterlegen (siehe README).");

  await browser.close();
}

// Playwrights storageState() speichert JEDEN localStorage-Eintrag der Origin -
// darunter auch grosse Analytics-Caches (z.B. PostHog), die nichts mit dem
// Login zu tun haben und allein hunderte KB ausmachen koennen (live beobachtet:
// 445 KB). Diese werden entfernt, damit die Datei unter dem GitHub-Actions-
// Secret-Limit (48 KB) bleibt.
function stripAnalyticsBloat(state) {
  for (const origin of state.origins ?? []) {
    origin.localStorage = (origin.localStorage ?? []).filter(
      (kv) => !kv.name.startsWith("ph_") && !kv.name.toLowerCase().includes("posthog")
    );
  }
}

main().catch((err) => {
  console.error("Login-Lauf fehlgeschlagen:", err);
  process.exit(1);
});
