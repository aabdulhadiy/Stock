import type { Currency } from "@/db/schema";

/**
 * Currency helpers. Product base prices are stored in UZS. A sale picks a
 * single currency (UZS or USD); USD figures are derived from the UZS base
 * using the exchange rate captured at sale time, and every sale also records
 * a UZS-equivalent total so cross-currency reporting stays apples-to-apples.
 */

/** Round to 2 decimals (money). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Convert a UZS base amount into the chosen sale currency. */
export function fromUzs(amountUzs: number, currency: Currency, rate: number): number {
  if (currency === "UZS") return Math.round(amountUzs);
  return round2(amountUzs / rate);
}

/** Convert an amount in the sale's currency back to its UZS equivalent. */
export function toUzs(amount: number, currency: Currency, rate: number): number {
  if (currency === "UZS") return Math.round(amount);
  return Math.round(amount * rate);
}

export interface LineInput {
  quantity: number;
  actualPrice: number; // in the sale's currency
}

/** Sum line totals (actualPrice * quantity) in the sale currency. */
export function saleTotal(items: LineInput[]): number {
  return round2(items.reduce((sum, i) => sum + i.actualPrice * i.quantity, 0));
}

/** Format a numeric amount for display with its currency. */
export function formatMoney(amount: number | string, currency: Currency): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (currency === "USD") {
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${Math.round(n).toLocaleString("ru-RU")} so'm`;
}
