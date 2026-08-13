import assert from "node:assert/strict";
import test from "node:test";
import { diemCycleStatus, halfMonthFor, paymentDateForEntitlement } from "./financial-diem-payment";
test("assigns first and second half diems to the documented payment dates", () => { assert.equal(halfMonthFor("2026-08-15"), "FIRST_HALF"); assert.equal(paymentDateForEntitlement("2026-08-15"), "2026-08-25"); assert.equal(paymentDateForEntitlement("2026-08-16"), "2026-09-10"); });
test("keeps a cycle partial when an eligible international diem has no rate", () => { assert.equal(diemCycleStatus([{ eligibilityStatus: "ELIGIBLE", amountMinorUnits: null }]), "PARTIAL"); });
