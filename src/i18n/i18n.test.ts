import test from "node:test";
import assert from "node:assert/strict";
import { en } from "./locales/en";
import { uz } from "./locales/uz";
import { ru } from "./locales/ru";
import { LOCALES, dictionaries, translator, formatDate, formatMoney, formatPercent, formatNumber, toDateOnly, parseDateOnly } from "./index";

/**
 * §13 makes translation completeness an acceptance criterion of every phase, so
 * it is a test rather than a review item.
 *
 * TypeScript already forces every locale to be a `Record<TranslationKey, string>`,
 * which catches missing keys at build time. These tests catch what types cannot:
 * blank values, stray keys, and placeholders dropped in translation — a lost
 * `{count}` would silently render a sentence with a hole in it.
 */

const LOCALE_FILES = { UZ: uz, RU: ru, EN: en } as const;

function placeholders(value: string): string[] {
  return (value.match(/\{(\w+)\}/g) ?? []).sort();
}

test("every locale is registered and complete", () => {
  assert.deepEqual(Object.keys(dictionaries).sort(), [...LOCALES].sort());

  const reference = Object.keys(en);
  assert.ok(reference.length > 500, `expected a substantial dictionary, got ${reference.length}`);

  for (const [code, dict] of Object.entries(LOCALE_FILES)) {
    const keys = Object.keys(dict);
    const missing = reference.filter((k) => !(k in dict));
    const extra = keys.filter((k) => !(k in en));

    assert.deepEqual(missing, [], `${code} is missing keys`);
    assert.deepEqual(extra, [], `${code} has keys not in the reference`);
    assert.equal(keys.length, reference.length, `${code} key count`);
  }
});

test("no translation is blank or left as its own key", () => {
  for (const [code, dict] of Object.entries(LOCALE_FILES)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.ok(value.trim().length > 0, `${code}.${key} is empty`);
      assert.notEqual(value, key, `${code}.${key} was left as the key itself`);
    }
  }
});

test("placeholders survive translation in every locale", () => {
  for (const [code, dict] of Object.entries(LOCALE_FILES)) {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      assert.deepEqual(
        placeholders(dict[key]),
        placeholders(en[key]),
        `${code}.${key} changed its placeholders`,
      );
    }
  }
});

test("untranslatable tokens are preserved", () => {
  // Brand names and template tokens must not be localised: they are typed into
  // settings fields or refer to third-party channels.
  const preserve: { key: keyof typeof en; needles: string[] }[] = [
    { key: "customer.channel.XAM_XAM", needles: ["XAM-XAM"] },
    { key: "settings.orderNumberHint", needles: ["{YYYY}", "{SEQ:4}", "ORD-2026-0001"] },
    { key: "settings.orderNumberInvalid", needles: ["{SEQ}"] },
  ];

  for (const [code, dict] of Object.entries(LOCALE_FILES)) {
    for (const { key, needles } of preserve) {
      for (const needle of needles) {
        assert.ok(
          dict[key].includes(needle),
          `${code}.${key} lost the literal ${needle}`,
        );
      }
    }
  }
});

test("the translator interpolates and falls back safely", () => {
  const t = translator("EN");
  assert.equal(t("dash.welcome", { name: "Aziza" }), "Welcome, Aziza");
  // A placeholder with no matching parameter is left visible rather than blanked,
  // so the gap gets noticed instead of shipping an odd sentence.
  assert.equal(t("dash.welcome"), "Welcome, {name}");
  // An unknown key renders as the key, which is loud enough to be spotted.
  assert.equal(
    translator("EN")("nope.not.a.key" as never),
    "nope.not.a.key",
  );
});

test("every locale translates the enum label keys the UI derives", () => {
  // These are built by string concatenation in lib/labels.ts, so a missing one
  // would only show up as a raw key on screen.
  const derived = [
    ...["DIRECTOR", "WAREHOUSEMAN", "SALESPERSON"].map((r) => `role.${r}`),
    ...["NEW", "PICKING", "READY", "SHIPPED", "CANCELLED"].map((s) => `order.status.${s}`),
    ...["MARKET", "EXPORT"].map((p) => `order.priceType.${p}`),
    ...["CASH", "BANK"].map((m) => `order.paymentMethod.${m}`),
    ...["EXPORT", "DOMESTIC", "XAM_XAM", "UZUM", "OTHER"].map((c) => `customer.channel.${c}`),
    ...["ACTIVE", "ARCHIVED"].map((s) => `product.status.${s}`),
    ...["UNIT", "BOX"].map((b) => `product.basis.${b}`),
    ...["UNITS", "BOXES", "BAGS"].map((e) => `order.enteredAs.${e}`),
    ...["RECEIPT", "SHIPMENT", "ADJUSTMENT", "RETURN"].map((m) => `stock.movementType.${m}`),
    ...["NORMAL", "SLOW", "FROZEN"].map((m) => `stock.movement.${m}`),
    ...["DRAFT", "SUBMITTED", "APPROVED", "CANCELLED"].map((s) => `count.status.${s}`),
    ...["FIXED", "VARIABLE"].map((x) => `expcat.type.${x}`),
    ...["A", "B", "C", "D"].map((g) => `customer.grade.${g}`),
    ...["day", "month", "year", "channel", "customer", "product"].map(
      (d) => `report.groupBy.${d}`,
    ),
    ...[
      "product",
      "category",
      "order",
      "order_item",
      "customer",
      "payment",
      "return",
      "expense",
      "expense_category",
      "recurring_expense",
      "user",
      "inventory_count",
      "stock",
      "settings",
    ].map((e) => `audit.entity.${e}`),
    ...[
      "create",
      "update",
      "delete",
      "cancel",
      "status_change",
      "price_change",
      "accept",
      "ship",
      "reserve",
      "adjust",
      "approve",
      "payment",
      "return",
      "login",
      "generate",
    ].map((a) => `audit.action.${a}`),
  ];

  for (const [code, dict] of Object.entries(LOCALE_FILES)) {
    for (const key of derived) {
      assert.ok(key in dict, `${code} is missing the derived key ${key}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Formatting (§13)
// ---------------------------------------------------------------------------

test("dates are DD.MM.YYYY in every language", () => {
  assert.equal(formatDate("2026-03-07"), "07.03.2026");
  assert.equal(formatDate(new Date(2026, 11, 31)), "31.12.2026");
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate("not a date"), "—");
});

test("a YYYY-MM-DD column value is read as a local calendar date", () => {
  // Parsing as UTC would shift the day in negative offsets and make a shipment
  // on the 1st display as the 31st.
  const parsed = parseDateOnly("2026-03-01");
  assert.equal(parsed?.getDate(), 1);
  assert.equal(parsed?.getMonth(), 2);
  assert.equal(toDateOnly(new Date(2026, 2, 1)), "2026-03-01");
});

test("money always renders as $ with two decimals", () => {
  for (const locale of LOCALES) {
    assert.match(formatMoney(123_456, locale), /^\$/);
    assert.ok(formatMoney(123_456, locale).includes("34"), "cents are shown");
  }
  assert.equal(formatMoney(0, "EN"), "$0.00");
  assert.equal(formatMoney(null, "EN"), "—");
  assert.equal(formatMoney(-500, "EN"), "-$5.00");
});

test("percentages distinguish zero from unknown", () => {
  assert.equal(formatPercent(0, "EN"), "0%");
  assert.equal(formatPercent(0.256, "EN"), "25.6%");
  assert.equal(formatPercent(null, "EN"), "—", "an unknown margin is not 0%");
  assert.equal(formatPercent(Infinity, "EN"), "—");
});

test("numbers are grouped for readability", () => {
  // Separators differ by locale; what matters is that a big number is grouped.
  for (const locale of LOCALES) {
    const formatted = formatNumber(1_234_567, locale);
    assert.ok(formatted.length > 7, `${locale}: ${formatted} is not grouped`);
  }
});
