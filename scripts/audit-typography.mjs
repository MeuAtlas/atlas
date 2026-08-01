import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const sourceRoot = join(root, "src");
const allowedTinyMetadata = new Map([
  ["src/app/admin/usuarios/page.tsx", 1], // UUID + account status
  ["src/app/admin/espacos/page.tsx", 1], // workspace technical identifier
  ["src/app/admin/modulos/page.tsx", 1], // short catalog badge metadata
]);
const forbidden = /text-xs|text-\[(?:7|8|9|10|11|12|13)px\]|fontSize\s*:\s*(?:[0-9]|1[01])(?:px)?\b/g;

function filesIn(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

const failures = [];
for (const path of filesIn(sourceRoot)) {
  if (![".ts", ".tsx"].includes(extname(path)) || path.endsWith(".test.ts")) continue;
  const source = readFileSync(path, "utf8");
  const matches = [...source.matchAll(forbidden)];
  const file = relative(root, path).replaceAll("\\", "/");
  const allowed = allowedTinyMetadata.get(file) ?? 0;
  if (matches.length > allowed) {
    failures.push(`${file}: ${matches.length} uso(s) pequeno(s), ${allowed} permitido(s)`);
  }
}

const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
for (const contract of [
  "--atlas-font-body: 1rem",
  "--atlas-font-secondary: .9375rem",
  ".finance-content :is(input, select, textarea) { min-height: 44px; font-size: 16px !important",
  ".finance-content :is(button, a) { min-height: 44px; font-size: 16px !important",
  ".atlas-field-input { font-size: 16px",
]) {
  if (!css.includes(contract)) failures.push(`globals.css: contrato ausente: ${contract}`);
}

if (failures.length) {
  console.error("Auditoria tipográfica falhou:\n" + failures.map(item => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Auditoria tipográfica aprovada (3 exceções de metadados técnicos). ");
}
