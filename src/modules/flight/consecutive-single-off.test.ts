import assert from "node:assert/strict";
import test from "node:test";
import { deriveConsecutiveSingleOff } from "./consecutive-single-off";

const item = (id: string, date: string, isSingleOff: boolean) => ({ id, startDate: date, endDate: date, isSingleOff });
test("identifies two distinct internal single off periods as a factual sequence", () => { const result = deriveConsecutiveSingleOff([item("a", "2026-08-02", true), item("b", "2026-08-04", true)], "2026-08-01", "2026-08-31"); assert.equal(result[0].isConsecutiveSingleOff, "TRUE"); assert.equal(result[1].previousSingleOffPeriodId, "a"); });
test("does not treat compound periods as two single offs", () => { const result = deriveConsecutiveSingleOff([{ id: "compound", startDate: "2026-08-02", endDate: "2026-08-03", isSingleOff: false }], "2026-08-01", "2026-08-31"); assert.equal(result.length, 0); });
test("returns false beside compound and unknown at document edges", () => { const internal = deriveConsecutiveSingleOff([item("a", "2026-08-02", true), { id: "compound", startDate: "2026-08-04", endDate: "2026-08-05", isSingleOff: false }], "2026-08-01", "2026-08-31"); assert.equal(internal[0].isConsecutiveSingleOff, "FALSE"); const edge = deriveConsecutiveSingleOff([item("edge", "2026-08-01", true)], "2026-08-01", "2026-08-31"); assert.equal(edge[0].isConsecutiveSingleOff, "UNKNOWN"); });
