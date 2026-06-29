import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRange, toDateInput } from "./date-range";

// Fixed reference: Wednesday, 2026-06-17 14:30 local.
const NOW = new Date(2026, 5, 17, 14, 30, 0);

test("today spans start to end of the current day", () => {
  const r = resolveRange({ preset: "today" }, NOW);
  assert.equal(r.from.getHours(), 0);
  assert.equal(r.from.getDate(), 17);
  assert.equal(r.to.getDate(), 17);
  assert.equal(r.to.getHours(), 23);
});

test("week starts on Monday", () => {
  const r = resolveRange({ preset: "week" }, NOW);
  assert.equal(r.from.getDay(), 1, "Monday");
  assert.equal(r.from.getDate(), 15, "Mon 2026-06-15");
});

test("month starts on the 1st", () => {
  const r = resolveRange({ preset: "month" }, NOW);
  assert.equal(r.from.getDate(), 1);
  assert.equal(r.from.getMonth(), 5);
});

test("default with no preset is this month", () => {
  const r = resolveRange({}, NOW);
  assert.equal(r.preset, "month");
  assert.equal(r.from.getDate(), 1);
});

test("custom honors from/to, inclusive end of day", () => {
  const r = resolveRange({ preset: "custom", from: "2026-06-01", to: "2026-06-10" }, NOW);
  assert.equal(toDateInput(r.from), "2026-06-01");
  assert.equal(toDateInput(r.to), "2026-06-10");
  assert.equal(r.to.getHours(), 23);
});

test("custom falls back to month start / now when dates missing", () => {
  const r = resolveRange({ preset: "custom" }, NOW);
  assert.equal(r.from.getDate(), 1);
  assert.equal(r.to.getDate(), 17);
});
