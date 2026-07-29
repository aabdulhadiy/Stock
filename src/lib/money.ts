/**
 * Money is an integer number of **cents** (USD) everywhere inside the system.
 * Parsing happens once, at the form/import boundary; from there on all sums,
 * margins and profit figures are exact integer arithmetic.
 *
 * §14: base currency is USD; the UZS rate in Settings is display-only.
 */

export const CENTS = 100;

/** True when a value is a safe, whole cent amount. */
export function isCents(value: number): boolean {
  return Number.isSafeInteger(value);
}

/**
 * Parse a user-entered money string ("1 234.56", "1234,56", "$12.5") to cents.
 * Returns null when the input is not a valid amount — callers surface a
 * validation error rather than silently coercing to 0.
 */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * CENTS);
  }

  // Strip currency symbols and group separators (space, NBSP, apostrophe).
  const cleaned = input
    .trim()
    .replace(/[$\s  ']/g, "")
    .replace(",", ".");
  if (cleaned === "") return null;
  if (!/^-?\d*(\.\d*)?$/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const digits = negative ? cleaned.slice(1) : cleaned;
  const [whole = "0", frac = ""] = digits.split(".");
  // More than 2 decimals is a typo, not a sub-cent price — reject it.
  if (frac.length > 2) return null;

  const cents = Number(whole || "0") * CENTS + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Cents -> a plain decimal string suitable for an <input type="number">. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / CENTS).toFixed(2);
}

/** Cents -> dollars as a number. Use only for display/ratios, never for sums. */
export function centsToDollars(cents: number): number {
  return cents / CENTS;
}

/**
 * Line total. Quantities are whole units and prices whole cents, so this stays
 * exact — no rounding decision to make.
 */
export function lineTotalCents(unitPriceCents: number, qtyUnits: number): number {
  return unitPriceCents * qtyUnits;
}

/** Gross profit for a shipped line, using the frozen cost snapshot. */
export function lineProfitCents(
  unitPriceCents: number,
  costSnapshotCents: number | null,
  qtyUnits: number,
): number {
  return (unitPriceCents - (costSnapshotCents ?? 0)) * qtyUnits;
}

/**
 * Margin as a fraction of revenue (0..1). Returns null when revenue is zero —
 * an undefined margin, which callers must not render as 0%.
 */
export function marginRatio(
  revenueCents: number,
  profitCents: number,
): number | null {
  if (revenueCents === 0) return null;
  return profitCents / revenueCents;
}

/**
 * Break-even revenue (§9.4): fixed expenses ÷ gross margin %.
 * Null when the margin is unknown or non-positive — at a zero or negative
 * margin no revenue volume ever covers fixed costs, and printing a number
 * there would be a lie.
 */
export function breakEvenRevenueCents(
  fixedExpensesCents: number,
  grossMargin: number | null,
): number | null {
  if (grossMargin === null || grossMargin <= 0) return null;
  return Math.round(fixedExpensesCents / grossMargin);
}
