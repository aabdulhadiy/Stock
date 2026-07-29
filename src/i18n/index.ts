import { en, type Dictionary, type TranslationKey } from "./locales/en";
import { uz } from "./locales/uz";
import { ru } from "./locales/ru";
import {
  DEFAULT_LOCALE,
  LOCALE_TAGS,
  type LocaleCode,
} from "./config";

export type { Dictionary, TranslationKey };
export * from "./config";

/**
 * The locale registry. Adding a language = one entry here plus one resource
 * file (§13 — no other code changes).
 */
export const dictionaries: Record<LocaleCode, Dictionary> = { UZ: uz, RU: ru, EN: en };

export type TranslateParams = Record<string, string | number>;

/** Translator function handed to both server and client components. */
export type T = (key: TranslationKey, params?: TranslateParams) => string;

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Build a translator for a locale. Falls back to the default locale, then to
 * the key itself — a missing string shows up as a visible key rather than an
 * empty gap, so it gets noticed and fixed.
 */
export function translator(locale: LocaleCode): T {
  const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
  return (key, params) => {
    const template = dict[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
    return interpolate(template, params);
  };
}

// ---------------------------------------------------------------------------
// Locale-aware formatting (§13: dates DD.MM.YYYY, grouped numbers, $)
// ---------------------------------------------------------------------------

/** Dates are DD.MM.YYYY in all three languages, per §13. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? parseDateOnly(value) : value;
  if (!d || Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export function formatDateTime(
  value: Date | string | null | undefined,
  locale: LocaleCode = DEFAULT_LOCALE,
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const time = new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${formatDate(d)} ${time}`;
}

/**
 * Parse a `YYYY-MM-DD` column value as a local calendar date. `new Date(str)`
 * would read it as UTC midnight and shift the day in negative offsets.
 */
export function parseDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** `YYYY-MM-DD` for a local date, for date columns and <input type="date">. */
export function toDateOnly(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function formatNumber(
  value: number,
  locale: LocaleCode = DEFAULT_LOCALE,
  maxFractionDigits = 0,
): string {
  return new Intl.NumberFormat(LOCALE_TAGS[locale], {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

/** Money from integer cents, always shown as `$` (§13). */
export function formatMoney(
  cents: number | null | undefined,
  locale: LocaleCode = DEFAULT_LOCALE,
): string {
  if (cents === null || cents === undefined) return "—";
  // The sign belongs in front of the currency symbol: "-$5.00", not "$-5.00".
  const sign = cents < 0 ? "-" : "";
  const formatted = new Intl.NumberFormat(LOCALE_TAGS[locale], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(cents) / 100);
  return `${sign}$${formatted}`;
}

/** Compact money for dashboard tiles: $12.3k / $1.2M. */
export function formatMoneyShort(
  cents: number,
  locale: LocaleCode = DEFAULT_LOCALE,
): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  if (abs < 10_000) return formatMoney(cents, locale);
  const sign = cents < 0 ? "-" : "";
  const [value, suffix] =
    abs >= 1_000_000 ? [abs / 1_000_000, "M"] : [abs / 1_000, "k"];
  return `${sign}$${new Intl.NumberFormat(LOCALE_TAGS[locale], {
    maximumFractionDigits: 1,
  }).format(value)}${suffix}`;
}

/** A ratio (0..1) as a percentage. Null renders as an em dash, never "0%". */
export function formatPercent(
  ratio: number | null | undefined,
  locale: LocaleCode = DEFAULT_LOCALE,
  digits = 1,
): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${new Intl.NumberFormat(LOCALE_TAGS[locale], {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(ratio * 100)}%`;
}

/** UZS reference display (§14) — rate is UZS per 1 USD. */
export function formatUzsReference(
  cents: number,
  uzsPerUsd: number,
  locale: LocaleCode = DEFAULT_LOCALE,
): string {
  const uzs = Math.round((cents / 100) * uzsPerUsd);
  return `${new Intl.NumberFormat(LOCALE_TAGS[locale], {
    maximumFractionDigits: 0,
  }).format(uzs)} UZS`;
}
