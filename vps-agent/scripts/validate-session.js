#!/usr/bin/env node
// Valida a sessão Spotify atual: abre a home headless e roda assertLoggedIn.
// Uso: node scripts/validate-session.js
import { browserPool } from "../src/playwright/browserPool.js";
import { assertLoggedIn, quickSessionPrecheck } from "../src/playwright/spotifySession.js";
import { config } from "../src/config.js";

(async () => {
  console.log("[validate] storageState:", config.SPOTIFY_STORAGE_STATE_PATH);
  try {
    await browserPool.withPage(async (page) => {
      const ok = await quickSessionPrecheck(page.context());
      console.log("[validate] cookies pré-flight:", ok ? "OK" : "FALTANDO");
      await page.goto(`${config.SPOTIFY_S4A_BASE.replace(/\/+$/, "")}/c/`, { waitUntil: "domcontentloaded" });
      await assertLoggedIn(page);
      console.log("[validate] ✅ sessão VÁLIDA — login detectado em", page.url());
    });
    process.exit(0);
  } catch (e) {
    console.error("[validate] ❌ FALHA:", e?.message || e);
    process.exit(2);
  } finally {
    await browserPool.dispose().catch(() => {});
  }
})();
