import { parseDateOnly, toDateOnly } from "@/i18n";

/**
 * Calendar helpers. Everything works in **local calendar dates** as
 * `YYYY-MM-DD` strings, matching the `date` columns: a shipment on the 1st is
 * on the 1st for the factory regardless of the server's UTC offset.
 */

export { parseDateOnly, toDateOnly };

export function today(now: Date = new Date()): string {
  return toDateOnly(now);
}

export function addDays(date: string, days: number): string {
  const d = parseDateOnly(date);
  if (!d) return date;
  d.setDate(d.getDate() + days);
  return toDateOnly(d);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number | null {
  const a = parseDateOnly(from);
  const b = parseDateOnly(to);
  if (!a || !b) return null;
  // Compare at midnight local, so DST transitions cannot produce 0.96 days.
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86_400_000);
}

/** Days elapsed since a past date, floored at 0. Null when the input is null. */
export function daysSince(date: string | null, now: string = today()): number | null {
  if (!date) return null;
  const n = daysBetween(date, now);
  return n === null ? null : Math.max(0, n);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const d = parseDateOnly(date);
  if (!d) return date;
  return toDateOnly(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function startOfYear(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}

export function endOfYear(date: string): string {
  return `${date.slice(0, 4)}-12-31`;
}

export function addMonths(date: string, months: number): string {
  const d = parseDateOnly(date);
  if (!d) return date;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  // Clamp: 31 Jan + 1 month is 28/29 Feb, not 2/3 March.
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toDateOnly(d);
}

/** `YYYY-MM` bucket key for monthly grouping. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** Every `YYYY-MM` from `from` to `to`, inclusive. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = startOfMonth(from);
  const last = monthKey(to);
  // Bound the loop: a corrupt range must not spin forever.
  for (let i = 0; i < 600 && monthKey(cursor) <= last; i++) {
    out.push(monthKey(cursor));
    cursor = addMonths(cursor, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Report periods (§10.3)
// ---------------------------------------------------------------------------

export type PeriodPreset =
  | "today"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_year"
  | "custom";

export interface Period {
  preset: PeriodPreset;
  from: string;
  to: string;
}

export const PERIOD_PRESETS: PeriodPreset[] = [
  "today",
  "this_month",
  "last_month",
  "this_quarter",
  "this_year",
  "custom",
];

export function resolvePeriod(
  preset: string | undefined,
  from: string | undefined,
  to: string | undefined,
  now: string = today(),
): Period {
  switch (preset) {
    case "today":
      return { preset: "today", from: now, to: now };
    case "last_month": {
      const prev = addMonths(startOfMonth(now), -1);
      return { preset: "last_month", from: prev, to: endOfMonth(prev) };
    }
    case "this_quarter": {
      const d = parseDateOnly(now)!;
      const firstMonth = Math.floor(d.getMonth() / 3) * 3;
      const start = toDateOnly(new Date(d.getFullYear(), firstMonth, 1));
      return { preset: "this_quarter", from: start, to: endOfMonth(addMonths(start, 2)) };
    }
    case "this_year":
      return { preset: "this_year", from: startOfYear(now), to: endOfYear(now) };
    case "custom": {
      const isDate = (v: string | undefined): v is string =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const f = isDate(from) ? from : startOfMonth(now);
      const t = isDate(to) ? to : now;
      // Tolerate a reversed range instead of returning nothing.
      return f <= t
        ? { preset: "custom", from: f, to: t }
        : { preset: "custom", from: t, to: f };
    }
    case "this_month":
    default:
      return { preset: "this_month", from: startOfMonth(now), to: endOfMonth(now) };
  }
}

export const PERIOD_LABEL_KEY: Record<PeriodPreset, string> = {
  today: "common.today",
  this_month: "common.thisMonth",
  last_month: "common.lastMonth",
  this_quarter: "common.thisQuarter",
  this_year: "common.thisYear",
  custom: "common.customRange",
};

/** Aging bucket for a receivable (§10.3). */
export type AgingBucket = "CURRENT" | "D1_7" | "D8_30" | "D30_PLUS";

export function agingBucket(
  dueDate: string | null,
  now: string = today(),
): AgingBucket {
  if (!dueDate) return "CURRENT";
  const overdue = daysBetween(dueDate, now) ?? 0;
  if (overdue <= 0) return "CURRENT";
  if (overdue <= 7) return "D1_7";
  if (overdue <= 30) return "D8_30";
  return "D30_PLUS";
}

export const AGING_LABEL_KEY: Record<AgingBucket, string> = {
  CURRENT: "recv.bucketCurrent",
  D1_7: "recv.bucket1to7",
  D8_30: "recv.bucket8to30",
  D30_PLUS: "recv.bucket30plus",
};

/** §8.2 customer grade from average payment delay in days. */
export function gradeFromDelay(avgDelayDays: number | null): "A" | "B" | "C" | "D" | null {
  if (avgDelayDays === null) return null;
  if (avgDelayDays <= 0) return "A";
  if (avgDelayDays <= 7) return "B";
  if (avgDelayDays <= 30) return "C";
  return "D";
}
