/**
 * ASCII-safe formatting shared by Excel and PDF exports. We avoid locale
 * separators (non-breaking spaces) and the "so'm" suffix so the standard PDF
 * fonts render everything cleanly.
 */

/** Group an integer with plain spaces: 1234567 -> "1 234 567". */
export function groupNumber(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = Math.abs(Math.round(n)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Money with an explicit currency suffix, e.g. "120 000 UZS" / "9.52 USD". */
export function money(amount: number | string, currency: "UZS" | "USD"): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (currency === "USD") {
    return `${n.toFixed(2)} USD`;
  }
  return `${groupNumber(n)} UZS`;
}

/** Timestamp for filenames: 2026-06-29. */
export function dateStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
