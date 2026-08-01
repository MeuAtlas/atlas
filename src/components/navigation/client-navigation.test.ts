import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(name) ? [path] : [];
  });
}

const standard = readFileSync("src/components/navigation/client-navigation.tsx", "utf8");
const feedback = readFileSync("src/components/navigation/navigation-feedback.tsx", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");
const styles = readFileSync("src/app/globals.css", "utf8");

test("internal query navigation preserves the shared shell and scroll", () => {
  assert.match(standard, /router\[history\]\(next, \{ scroll: false \}\)/);
  assert.match(standard, /new URLSearchParams\(\)/);
  assert.match(standard, /event\.preventDefault\(\)/);
});

test("data navigation blurs and blocks the page with accessible feedback", () => {
  assert.match(layout, /NavigationFeedbackProvider/);
  assert.match(standard, /useNavigationTransition/);
  assert.match(feedback, /role="status"/);
  assert.match(feedback, /aria-label="Atualizando dados"/);
  assert.match(styles, /\.atlas-navigation-overlay[\s\S]*backdrop-filter:\s*blur/);
  assert.match(styles, /z-index:\s*5000/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test("loading remains visible until the new route payload is committed", () => {
  assert.match(feedback, /usePathname\(\)/);
  assert.match(feedback, /useSearchParams\(\)/);
  assert.match(feedback, /signature === previous\.current/);
  assert.match(feedback, /window\.setTimeout\(complete, 30_000\)/);
  assert.doesNotMatch(feedback, /if \(!pending/);
});

test("filters use the shared client navigation standard", () => {
  const overview = readFileSync("src/components/finance/finance-account-filters.tsx", "utf8");
  const reports = readFileSync("src/app/financeiro/relatorios/page.tsx", "utf8");
  const invoices = readFileSync("src/components/finance/invoice-history-section.tsx", "utf8");
  for (const source of [overview, reports, invoices]) {
    assert.match(source, /ClientSearchForm/);
  }
});

test("internal UI never forces a document-level navigation", () => {
  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /window\.location\.(?:assign|replace|reload)\(|location\.href\s*=/,
      file,
    );
  }
});
