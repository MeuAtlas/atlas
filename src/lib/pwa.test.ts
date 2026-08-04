import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  canShowIosInstall,
  detectPwaDisplayMode,
  isIosDevice,
  isSafariBrowser,
  isSensitiveCacheUrl,
} from "./pwa";

test("detecta browser, standalone, fullscreen e compatibilidade iOS", () => {
  assert.equal(detectPwaDisplayMode({}), "browser");
  assert.equal(detectPwaDisplayMode({ standaloneMedia: true }), "standalone");
  assert.equal(detectPwaDisplayMode({ navigatorStandalone: true }), "standalone");
  assert.equal(detectPwaDisplayMode({ fullscreenMedia: true }), "fullscreen");
});

test("detecta iPhone, iPadOS e Safari sem confundir Chrome iOS", () => {
  assert.equal(isIosDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" }), true);
  assert.equal(isIosDevice({ platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isSafariBrowser("Mozilla/5.0 Version/18.0 Mobile Safari/604.1"), true);
  assert.equal(isSafariBrowser("Mozilla/5.0 CriOS/126.0 Mobile Safari/604.1"), false);
});

test("instrução iOS aparece somente no Safari elegível e fora do PWA", () => {
  assert.equal(canShowIosInstall({ ios: true, safari: true, displayMode: "browser", dismissed: false }), true);
  assert.equal(canShowIosInstall({ ios: true, safari: true, displayMode: "standalone", dismissed: false }), false);
  assert.equal(canShowIosInstall({ ios: true, safari: false, displayMode: "browser", dismissed: false }), false);
  assert.equal(canShowIosInstall({ ios: true, safari: true, displayMode: "browser", dismissed: true }), false);
});

test("classificador impede cache de dados autenticados e provedores", () => {
  for (const url of [
    "/api/invoice-imports",
    "/financeiro/movimentacoes",
    "/settings/family",
    "https://project.supabase.co/rest/v1/card_purchases",
    "https://api.pluggy.ai/transactions",
    "/arquivo/fatura.pdf",
  ]) assert.equal(isSensitiveCacheUrl(url), true, url);
  assert.equal(isSensitiveCacheUrl("/icons/atlas-192.png"), false);
});

test("manifest completo e ícones instaláveis existem", () => {
  const manifest = readFileSync("src/app/manifest.ts", "utf8");
  assert.match(manifest, /id: "\/"/);
  assert.match(manifest, /name: "Atlas"/);
  assert.match(manifest, /short_name: "Atlas"/);
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /orientation: "portrait-primary"/);
  assert.match(manifest, /atlas-192\.png/);
  assert.match(manifest, /atlas-512\.png/);
  assert.match(manifest, /purpose: "maskable"/);
  for (const name of ["atlas-192.png", "atlas-512.png", "atlas-maskable-192.png", "atlas-maskable-512.png", "atlas-apple-touch-icon.png"]) {
    assert.ok(statSync(join("public/icons", name)).size > 1_000, name);
  }
});

test("service worker guarda somente assets públicos e usa fallback offline", () => {
  const worker = readFileSync("public/sw.js", "utf8");
  assert.match(worker, /ATLAS_SW_VERSION/);
  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(worker, /fetch\(request\)\.catch\(\(\) => caches\.match\(OFFLINE_URL\)\)/);
  assert.match(worker, /SKIP_WAITING/);
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.match(worker, /startsWith\("\/_next\/static\/"\)/);
  assert.doesNotMatch(worker, /\\\.\(\?:css\|js/);
  assert.match(worker, /cache\.addAll\(PRECACHE\)/);
  assert.doesNotMatch(worker, /cache\.put\([^\n]*(?:api|financeiro|supabase|pluggy)/i);
});

test("headers protegem o worker e a aplicação", () => {
  const config = readFileSync("next.config.ts", "utf8");
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /X-Content-Type-Options/);
  assert.match(config, /Referrer-Policy/);
  assert.match(config, /Permissions-Policy/);
  assert.match(config, /Content-Type[\s\S]*application\/javascript; charset=utf-8/);
  assert.match(config, /no-cache, no-store, must-revalidate/);
  assert.match(config, /Service-Worker-Allowed[\s\S]*"\/"/);
});
