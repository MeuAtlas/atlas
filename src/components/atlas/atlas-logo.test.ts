import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const logo = read("src/components/atlas/atlas-logo.tsx");
const financeShell = read("src/components/finance/finance-shell.tsx");
const privateShell = read("src/components/atlas/private-shell.tsx");
const authShell = read("src/components/auth/auth-shell.tsx");
const errorPage = read("src/app/error.tsx");
const layout = read("src/app/layout.tsx");
const manifest = read("src/app/manifest.ts");
const css = read("src/app/globals.css");

test("componente central usa somente os assets oficiais claro e escuro", () => {
  assert.match(logo, /\/icons\/atlas-app-icon-light\.png/);
  assert.match(logo, /\/icons\/atlas-app-icon-dark\.png/);
  assert.match(logo, /AtlasLogoVariant = "auto" \| "light" \| "dark"/);
  assert.match(logo, /atlas-logo-wordmark/);
});

test("tema automático alterna as versões sem alterar o símbolo", () => {
  assert.match(
    css,
    /:root\[data-theme="dark"\] \.atlas-logo-auto \.atlas-logo-image-light\{display:none\}/,
  );
  assert.match(
    css,
    /:root\[data-theme="dark"\] \.atlas-logo-auto \.atlas-logo-image-dark\{display:block\}/,
  );
});

test("shells, login e erro compartilham a mesma assinatura Atlas", () => {
  for (const source of [financeShell, privateShell, authShell, errorPage]) {
    assert.match(source, /AtlasLogo/);
  }
  assert.doesNotMatch(financeShell, /function AtlasMark/);
  assert.doesNotMatch(css, /finance-atlas-mark/);
});

test("favicon, Apple touch icon e PWA apontam para a identidade oficial", () => {
  assert.match(layout, /atlas-app-icon-light\.png/);
  assert.match(layout, /atlas-app-icon-dark\.png/);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(manifest, /atlas-app-icon-dark\.png/);

  const faviconPath = join(root, "src/app/favicon.ico");
  const favicon = readFileSync(faviconPath);
  assert.equal(favicon.readUInt16LE(0), 0);
  assert.equal(favicon.readUInt16LE(2), 1);
  assert.ok(favicon.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
  assert.ok(statSync(faviconPath).size > 40_000);
});
