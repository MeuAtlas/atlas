import assert from "node:assert/strict";
import test from "node:test";
import { buildRollingSingleOff30d } from "./rolling-single-off";

const item = (id: string, date: string, isSingleOff = true) => ({ id, startDate: date, endDate: date, isSingleOff });
test("counts distinct singles in a complete 30-day window", () => { const result = buildRollingSingleOff30d([item("a", "2026-08-05"), item("b", "2026-08-20"), item("c", "2026-08-30")], "2026-08-01", "2026-08-31"); assert.equal(result.at(-1)?.value, 3); assert.deepEqual(result.at(-1)?.includedOffPeriodIds, ["a", "b", "c"]); });
test("does not count compound periods", () => { const result = buildRollingSingleOff30d([item("a", "2026-08-05"), item("compound", "2026-08-10", false), item("b", "2026-08-30")], "2026-08-01", "2026-08-31"); assert.equal(result.at(-1)?.value, 2); });
test("preserves unknown when the retrospective window requires unavailable history", () => { const [result] = buildRollingSingleOff30d([item("a", "2026-08-01")], "2026-08-01", "2026-08-31"); assert.equal(result.value, "UNKNOWN"); assert.equal(result.historyComplete, false); });
test("keeps imports isolated by accepting only supplied periods", () => { const planned = buildRollingSingleOff30d([item("planned", "2026-08-31")], "2026-08-01", "2026-08-31"); const snapshot = buildRollingSingleOff30d([item("snapshot", "2026-08-31")], "2026-08-01", "2026-08-31"); assert.deepEqual(planned[0].includedOffPeriodIds, ["planned"]); assert.deepEqual(snapshot[0].includedOffPeriodIds, ["snapshot"]); });
