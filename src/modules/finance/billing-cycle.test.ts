import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentBillingCycle } from "./billing-cycle";

test("ciclo antes ou no fechamento", () => {
  assert.deepEqual(
    getCurrentBillingCycle({
      closingDay: 17,
      dueDay: 1,
      referenceDate: new Date("2026-07-10T12:00:00Z"),
    }),
    {
      cycleStart: "2026-06-18",
      cycleEnd: "2026-07-17",
      closingDate: "2026-07-17",
      dueDate: "2026-08-01",
      previousCycleStart: "2026-05-18",
      previousCycleEnd: "2026-06-17",
      previousClosingDate: "2026-06-17",
      previousDueDate: "2026-07-01",
      nextCycleStart: "2026-07-18",
      nextCycleEnd: "2026-08-17",
      status: "open",
      daysUntilClosing: 7,
      referenceMonth: "2026-07",
    },
  );
});

test("Santander dia 03 mantém a fatura aberta de 04/07 a 03/08", () => {
  const cycle = getCurrentBillingCycle({
    closingDay: 3,
    dueDay: 10,
    referenceDate: new Date("2026-07-25T15:00:00Z"),
  });
  assert.equal(cycle.cycleStart, "2026-07-04");
  assert.equal(cycle.cycleEnd, "2026-08-03");
  assert.equal(cycle.closingDate, "2026-08-03");
  assert.equal(cycle.dueDate, "2026-08-10");
  assert.equal(cycle.previousCycleStart, "2026-06-04");
  assert.equal(cycle.previousCycleEnd, "2026-07-03");
  assert.equal(cycle.previousDueDate, "2026-07-10");
});

test("após o fechamento dia 03 inicia o ciclo no dia 04", () => {
  const cycle = getCurrentBillingCycle({
    closingDay: 3,
    dueDay: 10,
    referenceDate: new Date("2026-08-05T15:00:00Z"),
  });
  assert.equal(cycle.cycleStart, "2026-08-04");
  assert.equal(cycle.cycleEnd, "2026-09-03");
  assert.equal(cycle.dueDate, "2026-09-10");
});

test("mudança de ano preserva fechamento, vencimento e início exclusivo", () => {
  const cycle = getCurrentBillingCycle({
    closingDay: 3,
    dueDay: 10,
    referenceDate: new Date("2026-12-20T15:00:00Z"),
  });
  assert.equal(cycle.cycleStart, "2026-12-04");
  assert.equal(cycle.cycleEnd, "2027-01-03");
  assert.equal(cycle.dueDate, "2027-01-10");
});

test("ciclo depois do fechamento", () => {
  const cycle = getCurrentBillingCycle({
    closingDay: 17,
    dueDay: 1,
    referenceDate: new Date("2026-07-23T12:00:00Z"),
  });
  assert.equal(cycle.cycleStart, "2026-07-18");
  assert.equal(cycle.closingDate, "2026-08-17");
  assert.equal(cycle.dueDate, "2026-09-01");
  assert.equal(cycle.daysUntilClosing, 25);
});

test("fechamento 31 usa o último dia de fevereiro comum", () => {
  const cycle = getCurrentBillingCycle({
    closingDay: 31,
    dueDay: 10,
    referenceDate: new Date("2025-02-10T12:00:00Z"),
  });
  assert.equal(cycle.closingDate, "2025-02-28");
  assert.equal(cycle.cycleStart, "2025-02-01");
  assert.equal(cycle.dueDate, "2025-03-10");
});

test("fechamento 31 respeita fevereiro bissexto", () => {
  const cycle = getCurrentBillingCycle({
    closingDay: 31,
    dueDay: 10,
    referenceDate: new Date("2024-02-29T12:00:00Z"),
  });
  assert.equal(cycle.closingDate, "2024-02-29");
  assert.equal(cycle.cycleStart, "2024-02-01");
});
