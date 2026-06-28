import { test } from "node:test";
import assert from "node:assert/strict";
import { fromUzs, toUzs, saleTotal, round2 } from "./currency";

test("round2 rounds to two decimals", () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.344), 2.34);
});

test("fromUzs keeps UZS whole and converts USD", () => {
  assert.equal(fromUzs(126000, "UZS", 12600), 126000);
  assert.equal(fromUzs(126000, "USD", 12600), 10);
  assert.equal(fromUzs(63000, "USD", 12600), 5);
});

test("toUzs converts back to UZS equivalent", () => {
  assert.equal(toUzs(10, "USD", 12600), 126000);
  assert.equal(toUzs(126000, "UZS", 12600), 126000);
});

test("saleTotal sums line items in sale currency", () => {
  assert.equal(saleTotal([{ quantity: 2, actualPrice: 5 }, { quantity: 3, actualPrice: 1.5 }]), 14.5);
});

test("USD round-trip stays consistent for reporting", () => {
  const rate = 12600;
  const usd = fromUzs(50000, "USD", rate); // 3.97
  const backToUzs = toUzs(usd, "USD", rate);
  assert.ok(Math.abs(backToUzs - 50000) < rate); // within rounding of one unit
});
