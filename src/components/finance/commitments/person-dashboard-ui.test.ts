import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const component = readFileSync(
  join(process.cwd(), "src/components/finance/commitments/person-details.tsx"),
  "utf8",
);
const styles = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

test("modal segue a hierarquia financeira sem automações por contraparte", () => {
  const labels = [
    "Gasto {period.label",
    "Evolução dos gastos",
    "Com o que estou gastando",
    "Recorrentes e extraordinários",
    "Movimentações",
    "<h3>Pix</h3>",
    "Despesas compartilhadas e reembolsos",
    "Próximos compromissos",
  ];
  let previous = -1;
  for (const label of labels) {
    const position = component.indexOf(label);
    assert.ok(position > previous, `${label} deve respeitar a ordem da tela`);
    previous = position;
  }
  assert.doesNotMatch(component, /Vínculos automáticos Pix/);
});

test("reembolsos são condicionais e cards zerados não dominam o topo", () => {
  assert.match(component, /dashboard\.reimbursementSummary\.visible \?/);
  assert.doesNotMatch(component, /Parte assumida por mim/);
  assert.match(component, /Gasto \{period\.label/);
  assert.match(component, /Média mensal/);
  assert.match(component, /Variação mensal/);
  assert.match(component, /Próximos 30 dias/);
});

test("filtro de período atualiza o dashboard local sem request no frontend", () => {
  assert.match(component, /resolvePersonDashboardPeriod/);
  assert.match(component, /selectPersonFinancialDashboard/);
  assert.match(component, /Últimos 3 meses/);
  assert.match(component, /Últimos 6 meses/);
  assert.match(component, /Personalizado/);
  assert.doesNotMatch(component, /\bfetch\(/);
});

test("layout é grande, central e responsivo sem tabela horizontal no mobile", () => {
  assert.match(styles, /\.person-dashboard\{height:min\(92dvh,960px\)/);
  assert.match(styles, /@media\(max-width:640px\)\{\.person-dashboard/);
  assert.match(
    styles,
    /\.person-dashboard-summary\{[^}]*grid-template-columns:repeat\(4/,
  );
  assert.match(styles, /\.person-dashboard-summary\{grid-template-columns:1fr 1fr\}/);
  assert.match(styles, /\.person-movement-list a\{grid-template-columns:minmax\(0,1fr\) auto/);
});
