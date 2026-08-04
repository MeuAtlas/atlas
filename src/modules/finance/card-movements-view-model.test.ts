import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildCardMovementsViewModel,
  formatInstallmentLabel,
  isInstallmentTransaction,
  splitCardTransactions,
} from "./card-movements-view-model";
import type { MovementListItem } from "./movement-filters";

function movement(
  id: string,
  date: string,
  amount: number,
  installmentNumber: number | null = null,
  installmentTotal: number | null = null,
) {
  return {
    id,
    sourceKind: "card_purchase",
    date,
    amount,
    amountBrl: amount,
    installmentNumber,
    installmentTotal,
    consumptionEffect: "expense",
    isIgnored: false,
  } as MovementListItem;
}

test("recognizes installments only when both reliable installment numbers are valid", () => {
  assert.equal(isInstallmentTransaction(movement("a", "2026-07-05", 10, 3, 10)), true);
  assert.equal(isInstallmentTransaction(movement("b", "2026-07-05", 10, 1, 1)), false);
  assert.equal(isInstallmentTransaction(movement("c", "2026-07-05", 10, 3, null)), false);
  assert.equal(isInstallmentTransaction(movement("d", "2026-07-05", 10, 11, 10)), false);
});

test("splits without duplicating the same movement in either section", () => {
  const installment = movement("parcelada", "2026-07-05", 129.9, 3, 10);
  const regular = movement("avista", "2026-07-04", 50.57);
  const result = splitCardTransactions([installment, regular, installment]);
  assert.deepEqual(result.installments.map(item => item.id), ["parcelada"]);
  assert.deepEqual(result.regular.map(item => item.id), ["avista"]);
  assert.equal(new Set([...result.installments, ...result.regular].map(item => item.id)).size, 2);
  assert.equal(formatInstallmentLabel(installment), "3/10");
});

test("groups only regular purchases by day and calculates each daily total", () => {
  const result = buildCardMovementsViewModel([
    movement("p", "2026-07-05", 129.9, 3, 10),
    movement("a", "2026-07-05", 20.93),
    movement("b", "2026-07-05", 50.57),
    movement("c", "2026-07-04", 82.36),
  ]);
  assert.equal(result.installments.length, 1);
  assert.deepEqual(result.regularGroups.map(group => ({
    date: group.date,
    count: group.items.length,
    total: group.total,
  })), [
    { date: "2026-07-05", count: 2, total: 71.5 },
    { date: "2026-07-04", count: 1, total: 82.36 },
  ]);
});

test("card screen follows the approved section order and keeps details outside the compact rows", () => {
  const source = readFileSync("src/components/finance/movements-browser.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  const page = readFileSync("src/app/financeiro/movimentacoes/page.tsx", "utf8");
  const cardRows = source.slice(
    source.indexOf("function CardMovementRow"),
    source.indexOf("function CardMovementsSections"),
  );
  assert.ok(source.indexOf("Compras parceladas") < source.indexOf("Compras do per"));
  assert.match(source, /card-movement-table-head is-installment/);
  assert.match(source, /card-movement-table-head is-regular/);
  assert.doesNotMatch(cardRows, /categoryName|displayType|Compra no cart/);
  assert.match(source, /aria-expanded=\{!collapsed\}/);
  assert.match(source, /Tipo de compra/);
  assert.match(styles, /\.card-movement-row\.is-installment\{grid-template-columns:/);
  assert.match(styles, /@media\(max-width:640px\)[\s\S]*\.card-movement-table-head\{display:none\}/);
  assert.match(page, /\.\.\.cardSections\.installments/);
  assert.match(page, /cardSections\.regular\.slice\(offset, offset \+ PAGE_SIZE\)/);
});
