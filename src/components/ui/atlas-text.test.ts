import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const component = readFileSync(join(root, "src/components/ui/atlas-text.tsx"), "utf8");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

test("AtlasText exposes semantic roles instead of size names", () => {
  for (const role of [
    "pageTitle", "pageSubtitle", "modalTitle", "sectionTitle", "cardTitle",
    "itemTitle", "body", "secondary", "label", "caption", "financialValue",
    "financialValueSmall", "button", "tableHeader", "tableBody", "formLabel",
    "formHelp", "error", "badge",
  ]) assert.match(component, new RegExp(`${role}: \\"atlas-`));
  assert.match(component, /as\?: ElementType/);
});

test("semantic tokens render with responsive mobile minimums", () => {
  assert.match(css, /--atlas-font-page-title:/);
  assert.match(css, /--atlas-font-modal-title:/);
  assert.match(css, /--atlas-line-body: 1\.55/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /--atlas-font-body: 1rem/);
  assert.match(css, /--atlas-font-secondary: \.9375rem/);
  assert.match(css, /--atlas-font-caption: \.875rem/);
  assert.match(css, /\.atlas-button-label \{ font-size: 1rem/);
  assert.match(css, /\.atlas-form-label,[\s\S]*font-size: \.9375rem/);
  assert.match(css, /\.atlas-field-input \{ font-size: 16px/);
  assert.match(css, /\.atlas-primary,[\s\S]*font-size: 16px/);
});
