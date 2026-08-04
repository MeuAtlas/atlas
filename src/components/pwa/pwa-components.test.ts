import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const context = readFileSync("src/components/pwa/pwa-context.tsx", "utf8");
const runtime = readFileSync("src/components/pwa/pwa-runtime.tsx", "utf8");
const settings = readFileSync("src/components/pwa/pwa-device-settings.tsx", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

test("registro do worker é progressivo e não bloqueia desenvolvimento", () => {
  assert.match(context, /process\.env\.NODE_ENV !== "production"/);
  assert.match(context, /navigator\.serviceWorker\.register\("\/sw\.js"/);
  assert.match(context, /updateViaCache: "none"/);
  assert.match(context, /registration\.update\(\)/);
  assert.match(layout, /<PwaRuntime>/);
});

test("instalação Android e desktop depende de gesto e trata recusa", () => {
  assert.match(context, /beforeinstallprompt/);
  assert.match(context, /event\.preventDefault\(\)/);
  assert.match(context, /await installPrompt\.prompt\(\)/);
  assert.match(context, /choice\.outcome === "accepted"/);
  assert.match(runtime, /pwa\.installAvailable \? pwa\.install/);
});

test("instalação iOS possui passos, dispensa e não reaparece standalone", () => {
  assert.match(runtime, /Compartilhar do Safari/);
  assert.match(runtime, /Adicionar à Tela de Início/);
  assert.match(runtime, /Não mostrar novamente/);
  assert.match(context, /displayMode: mode/);
  assert.match(context, /IOS_DISMISSED_KEY/);
});

test("offline bloqueia escrita e informa reconexão", () => {
  assert.match(context, /form\.method\.toLowerCase\(\) === "get"/);
  assert.match(context, /event\.preventDefault\(\)/);
  assert.match(runtime, /Esta ação precisa de internet/);
  assert.match(runtime, /Sem internet\. Os dados não serão atualizados/);
  assert.match(runtime, /Conexão restabelecida/);
  assert.match(runtime, /Conclua a ação atual antes de atualizar o Atlas/);
});

test("atualização exige ação, pode ser adiada e evita loop", () => {
  assert.match(runtime, /Atualizar agora/);
  assert.match(runtime, />Depois</);
  assert.match(context, /SKIP_WAITING/);
  assert.match(context, /UPDATE_RELOAD_KEY/);
  assert.match(context, /importar-fatura\|relatorios/);
});

test("configurações oferecem instalação, notificação e limpeza local", () => {
  assert.match(settings, /Instalar Atlas/);
  assert.match(settings, /Ativar notificações/);
  assert.match(settings, /Instale o Atlas para ativar notificações/);
  assert.match(settings, /Limpar dados locais/);
  assert.match(settings, /Diagnóstico do PWA/);
  assert.match(context, /Notification\.requestPermission\(\)/);
  assert.match(context, /key\.startsWith\("atlas-pwa-"\)/);
});

test("safe areas cobrem modo instalado, modal, toast e offline", () => {
  assert.match(layout, /viewportFit: "cover"/);
  for (const token of ["safe-top", "safe-right", "safe-bottom", "safe-left", "safe-x", "safe-y"]) {
    assert.match(css, new RegExp(`\\.${token}`));
  }
  assert.match(css, /data-pwa-display-mode="standalone"/);
  assert.match(css, /pwa-modal-backdrop[\s\S]*safe-area-inset-top/);
});
