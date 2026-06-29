/**
 * Date-range presets for reports (today / this week / this month / custom).
 * Pure functions so they're easy to unit-test. "Week" starts on Monday.
 */

export type RangePreset = "today" | "week" | "month" | "custom";

export interface DateRange {
  preset: RangePreset;
  from: Date;
  to: Date;
  label: string;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return x;
}

function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve a range from query params. `now` is injectable for testing.
 */
export function resolveRange(
  params: { preset?: string; from?: string; to?: string },
  now: Date = new Date(),
): DateRange {
  const preset = (params.preset ?? "month") as RangePreset;

  if (preset === "today") {
    return { preset, from: startOfDay(now), to: endOfDay(now), label: "Today" };
  }
  if (preset === "week") {
    return { preset, from: startOfWeek(now), to: endOfDay(now), label: "This week" };
  }
  if (preset === "custom") {
    const from = parseDate(params.from) ?? startOfMonth(now);
    const to = parseDate(params.to);
    return {
      preset,
      from: startOfDay(from),
      to: to ? endOfDay(to) : endOfDay(now),
      label: "Custom",
    };
  }
  // default: month
  return { preset: "month", from: startOfMonth(now), to: endOfDay(now), label: "This month" };
}

/** Format a Date as yyyy-mm-dd for <input type="date"> values. */
export function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
