import "server-only";
import { inArray } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { settings } from "@/db/schema";

/**
 * Director-editable settings (§14). Every setting has a typed default here, so
 * a missing or corrupt row degrades to a sane value instead of breaking a page.
 */

export interface AppSettings {
  /** Days without a sale before a product is "Slow" (§4.3). */
  slowDays: number;
  /** Days without a sale before a product is "Frozen" (§4.3). */
  frozenDays: number;
  /** XYZ: coefficient of variation (%) up to which a product is X (§4.4). */
  xyzXMaxPct: number;
  /** XYZ: variation (%) up to which a product is Y; above it, Z. */
  xyzYMaxPct: number;
  /** UZS per 1 USD — reference display only (§14). */
  uzsPerUsd: number;
  /** Inactivity timeout in hours (§2.3, default 12). */
  sessionTimeoutHours: number;
  /** Order number template, e.g. "ORD-{YYYY}-{SEQ:4}" (§5.1). */
  orderNumberFormat: string;
  /** The Salesperson role is disabled by default (§2.1). */
  salespersonEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  slowDays: 30,
  frozenDays: 90,
  xyzXMaxPct: 25,
  xyzYMaxPct: 50,
  uzsPerUsd: 12600,
  sessionTimeoutHours: 12,
  orderNumberFormat: "ORD-{YYYY}-{SEQ:4}",
  salespersonEnabled: false,
};

/** DB key for each setting field. */
const KEYS: Record<keyof AppSettings, string> = {
  slowDays: "stock.slow_days",
  frozenDays: "stock.frozen_days",
  xyzXMaxPct: "analytics.xyz_x_max_pct",
  xyzYMaxPct: "analytics.xyz_y_max_pct",
  uzsPerUsd: "currency.uzs_per_usd",
  sessionTimeoutHours: "auth.session_timeout_hours",
  orderNumberFormat: "orders.number_format",
  salespersonEnabled: "roles.salesperson_enabled",
};

export const SETTING_KEYS = KEYS;

const FIELDS = Object.keys(KEYS) as (keyof AppSettings)[];

function parseSetting<K extends keyof AppSettings>(
  field: K,
  raw: string,
): AppSettings[K] {
  const fallback = DEFAULT_SETTINGS[field];
  if (typeof fallback === "boolean") {
    return (raw === "true") as AppSettings[K];
  }
  if (typeof fallback === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : fallback) as AppSettings[K];
  }
  return (raw || fallback) as AppSettings[K];
}

/**
 * Load all settings. Not memoized across requests on purpose — a Director
 * changing a threshold must take effect on the next page load, and this is a
 * single indexed read of a handful of rows.
 */
export async function getSettings(exec: Executor = db): Promise<AppSettings> {
  const rows = await exec
    .select()
    .from(settings)
    .where(inArray(settings.key, Object.values(KEYS)));

  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULT_SETTINGS };
  for (const field of FIELDS) {
    const raw = byKey.get(KEYS[field]);
    if (raw !== undefined) {
      // @ts-expect-error — parseSetting returns the field's own type.
      out[field] = parseSetting(field, raw);
    }
  }
  return out;
}

/** Persist a partial update. Callers are responsible for validation + audit. */
export async function saveSettings(
  patch: Partial<AppSettings>,
  exec: Executor = db,
): Promise<void> {
  const entries = Object.entries(patch) as [keyof AppSettings, unknown][];
  for (const [field, value] of entries) {
    if (value === undefined) continue;
    const key = KEYS[field];
    if (!key) continue;
    await exec
      .insert(settings)
      .values({ key, value: String(value) })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: String(value), updatedAt: new Date() },
      });
  }
}

/**
 * Render an order number from the template. `{YYYY}` = 4-digit year,
 * `{SEQ}` / `{SEQ:n}` = sequence, zero-padded to n digits.
 */
export function formatOrderNumber(
  template: string,
  year: number,
  seq: number,
): string {
  return template
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{YY\}/g, String(year % 100).padStart(2, "0"))
    .replace(/\{SEQ(?::(\d+))?\}/g, (_whole, width?: string) =>
      String(seq).padStart(width ? Number(width) : 1, "0"),
    );
}

/** A template is usable only if it produces a distinct number per sequence. */
export function isValidOrderNumberFormat(template: string): boolean {
  return /\{SEQ(?::\d+)?\}/.test(template);
}
