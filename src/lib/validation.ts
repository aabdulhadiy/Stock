import { z } from "zod";
import { msg } from "@/lib/forms";
import { parseMoneyToCents } from "@/lib/money";

/**
 * Shared zod schemas. Every message is a translation key (see `lib/forms.ts`),
 * so validation text is localised like everything else (§13).
 *
 * Inputs arrive as `FormData` strings, so the primitives here do the coercion
 * and reject rather than silently defaulting — a blank price must be an error,
 * not $0.00.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const requiredText = (max = 200) =>
  z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, { message: msg("valid.required") })
    .refine((v) => v.length <= max, { message: msg("valid.maxLength", { max }) });

export const optionalText = (max = 2000) =>
  z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length <= max, { message: msg("valid.maxLength", { max }) })
    .transform((v) => (v === "" ? null : v));

/** Whole number ≥ 0. Blank is rejected; use `optionalInt` for nullable fields. */
export const requiredInt = (opts: { min?: number; max?: number } = {}) =>
  z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v !== "", { message: msg("valid.required") })
    .refine((v) => /^-?\d+$/.test(v), { message: msg("valid.integer") })
    .transform((v) => Number(v))
    .refine((n) => Number.isSafeInteger(n), { message: msg("valid.integer") })
    .refine((n) => n >= (opts.min ?? 0), {
      message: opts.min && opts.min > 0 ? msg("valid.positive") : msg("valid.nonNegative"),
    })
    .refine((n) => opts.max === undefined || n <= opts.max, {
      message: msg("valid.integer"),
    });

export const optionalInt = (opts: { min?: number } = {}) =>
  z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v === "" || /^-?\d+$/.test(v), { message: msg("valid.integer") })
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((n) => n === null || Number.isSafeInteger(n), {
      message: msg("valid.integer"),
    })
    .refine((n) => n === null || n >= (opts.min ?? 0), {
      message: msg("valid.nonNegative"),
    });

/** A decimal measure (weight, volume, dimension) kept as a string for numeric columns. */
export const requiredDecimal = (opts: { max?: number; scale?: number } = {}) =>
  z
    .string()
    .transform((v) => v.trim().replace(",", "."))
    .refine((v) => v !== "", { message: msg("valid.required") })
    .refine((v) => /^\d*(\.\d+)?$/.test(v), { message: msg("valid.number") })
    .refine((v) => Number(v) > 0, { message: msg("valid.positive") })
    .refine((v) => opts.max === undefined || Number(v) <= opts.max, {
      message: msg("valid.number"),
    })
    .transform((v) => Number(v).toFixed(opts.scale ?? 6));

export const optionalDecimal = (opts: { scale?: number } = {}) =>
  z
    .string()
    .transform((v) => v.trim().replace(",", "."))
    .refine((v) => v === "" || /^\d*(\.\d+)?$/.test(v), {
      message: msg("valid.number"),
    })
    .refine((v) => v === "" || Number(v) > 0, { message: msg("valid.positive") })
    .transform((v) => (v === "" ? null : Number(v).toFixed(opts.scale ?? 6)));

/** Money in, integer cents out. */
export const requiredMoney = () =>
  z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v !== "", { message: msg("valid.required") })
    .transform((v) => parseMoneyToCents(v))
    .refine((cents): cents is number => cents !== null, { message: msg("valid.money") })
    .refine((cents) => cents >= 0, { message: msg("valid.nonNegative") });

export const positiveMoney = () =>
  requiredMoney().refine((cents) => cents > 0, { message: msg("valid.positive") });

export const optionalMoney = () =>
  z
    .string()
    .transform((v) => v.trim())
    .transform((v) => (v === "" ? null : parseMoneyToCents(v)))
    .refine((cents) => cents === null || cents !== null, { message: msg("valid.money") })
    .refine((cents) => cents === null || cents >= 0, {
      message: msg("valid.nonNegative"),
    });

/** `YYYY-MM-DD` from a date input, validated as a real calendar date. */
export const requiredDate = () =>
  z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v !== "", { message: msg("valid.required") })
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), { message: msg("valid.date") })
    .refine((v) => {
      const [y, m, d] = v.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      return (
        date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
      );
    }, { message: msg("valid.date") });

export const optionalDate = () =>
  z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), {
      message: msg("valid.date"),
    })
    .transform((v) => (v === "" ? null : v));

export const uuid = () => z.string().uuid({ message: msg("valid.notFound") });

export const optionalUuid = () =>
  z
    .string()
    .transform((v) => v.trim())
    .transform((v) => (v === "" || v === "none" ? null : v))
    .refine(
      (v) =>
        v === null ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
      { message: msg("valid.notFound") },
    );

export const checkbox = () =>
  z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true" || v === "1");

/** A required <select> whose options are a known enum. */
export const enumField = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { message: msg("valid.selectOne") });

// ---------------------------------------------------------------------------
// Domain enums (mirrors of the DB enums, for form parsing)
// ---------------------------------------------------------------------------

export const ROLES = ["DIRECTOR", "WAREHOUSEMAN", "SALESPERSON"] as const;
export const LOCALES = ["UZ", "RU", "EN"] as const;
export const PRICE_TYPES = ["MARKET", "EXPORT"] as const;
export const PRODUCT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const MEASURE_BASES = ["UNIT", "BOX"] as const;
export const ENTERED_AS = ["UNITS", "BOXES", "BAGS"] as const;
export const PAYMENT_METHODS = ["CASH", "BANK"] as const;
export const CHANNELS = ["EXPORT", "DOMESTIC", "XAM_XAM", "UZUM", "OTHER"] as const;
export const EXPENSE_TYPES = ["FIXED", "VARIABLE"] as const;

/** §5.4 payment terms. */
export const PAYMENT_TERMS = [0, 7, 10, 15, 30, 60] as const;

export const paymentTerm = () =>
  requiredInt({ min: 0, max: 365 }).refine(
    (n) => (PAYMENT_TERMS as readonly number[]).includes(n),
    { message: msg("valid.selectOne") },
  );

/** Export price is the default for the Export channel; Market for the rest (§8.1). */
export function priceTypeForChannel(
  channel: (typeof CHANNELS)[number],
): (typeof PRICE_TYPES)[number] {
  return channel === "EXPORT" ? "EXPORT" : "MARKET";
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const productSchema = z.object({
  sku: requiredText(64),
  name: requiredText(200),
  categoryId: optionalUuid(),
  unitsPerBox: requiredInt({ min: 1 }),
  unitsPerBag: optionalInt({ min: 1 }),
  boxVolumeM3: requiredDecimal({ max: 1000, scale: 6 }),
  bagVolumeM3: optionalDecimal({ scale: 6 }),
  weightKg: requiredDecimal({ max: 100000, scale: 3 }),
  weightBasis: enumField(MEASURE_BASES),
  dimLengthCm: requiredDecimal({ max: 100000, scale: 1 }),
  dimWidthCm: requiredDecimal({ max: 100000, scale: 1 }),
  dimHeightCm: requiredDecimal({ max: 100000, scale: 1 }),
  dimsBasis: enumField(MEASURE_BASES),
  costPriceCents: requiredMoney(),
  marketPriceCents: requiredMoney(),
  exportPriceCents: requiredMoney(),
  status: enumField(PRODUCT_STATUSES),
  minStock: optionalInt({ min: 0 }),
});

export const categorySchema = z.object({
  name: requiredText(100),
});

export const customerSchema = z.object({
  name: requiredText(200),
  phone: requiredText(40),
  city: optionalText(200),
  channel: enumField(CHANNELS),
  defaultPriceType: enumField(PRICE_TYPES),
  defaultTermDays: optionalInt({ min: 0 }),
  note: optionalText(2000),
});

export const userCreateSchema = z.object({
  name: requiredText(200),
  login: requiredText(64).refine((v) => /^[a-z0-9._-]+$/i.test(v), {
    message: msg("valid.required"),
  }),
  role: enumField(ROLES),
  locale: enumField(LOCALES),
  password: z.string().refine((v) => v.length >= 8, {
    message: msg("valid.minLength", { min: 8 }),
  }),
});

export const userUpdateSchema = userCreateSchema.omit({ password: true }).extend({
  password: z
    .string()
    .refine((v) => v === "" || v.length >= 8, {
      message: msg("valid.minLength", { min: 8 }),
    })
    .transform((v) => (v === "" ? null : v)),
});

export const loginSchema = z.object({
  login: requiredText(64),
  password: z.string().refine((v) => v.length > 0, { message: msg("valid.required") }),
});

export const receiptLineSchema = z.object({
  productId: uuid(),
  qty: requiredInt({ min: 1 }),
  enteredAs: enumField(ENTERED_AS),
});

export const orderHeaderSchema = z.object({
  customerId: uuid(),
  priceType: enumField(PRICE_TYPES),
  plannedShipDate: requiredDate(),
  paymentMethod: enumField(PAYMENT_METHODS),
  paymentTermDays: paymentTerm(),
  note: optionalText(2000),
});

export const orderLineSchema = z.object({
  productId: uuid(),
  qty: requiredInt({ min: 1 }),
  enteredAs: enumField(ENTERED_AS),
  unitPriceCents: requiredMoney(),
});

export const paymentSchema = z.object({
  orderId: uuid(),
  paidOn: requiredDate(),
  amountCents: positiveMoney(),
  method: enumField(PAYMENT_METHODS),
  note: optionalText(500),
});

export const expenseSchema = z.object({
  expenseDate: requiredDate(),
  categoryId: uuid(),
  amountCents: positiveMoney(),
  method: enumField(PAYMENT_METHODS),
  description: optionalText(1000),
});

export const expenseCategorySchema = z.object({
  name: requiredText(100),
  type: enumField(EXPENSE_TYPES),
});

export const recurringExpenseSchema = z.object({
  categoryId: uuid(),
  amountCents: positiveMoney(),
  method: enumField(PAYMENT_METHODS),
  description: optionalText(500),
});

export const settingsSchema = z
  .object({
    slowDays: requiredInt({ min: 1, max: 3650 }),
    frozenDays: requiredInt({ min: 1, max: 3650 }),
    xyzXMaxPct: requiredInt({ min: 1, max: 100 }),
    xyzYMaxPct: requiredInt({ min: 1, max: 1000 }),
    uzsPerUsd: requiredInt({ min: 1, max: 100_000_000 }),
    sessionTimeoutHours: requiredInt({ min: 1, max: 720 }),
    orderNumberFormat: requiredText(64),
    salespersonEnabled: checkbox(),
  })
  .refine((v) => v.frozenDays > v.slowDays, {
    message: msg("settings.frozenOrder"),
    path: ["frozenDays"],
  })
  .refine((v) => v.xyzYMaxPct > v.xyzXMaxPct, {
    message: msg("settings.xyzOrder"),
    path: ["xyzYMaxPct"],
  })
  .refine((v) => /\{SEQ(?::\d+)?\}/.test(v.orderNumberFormat), {
    message: msg("settings.orderNumberInvalid"),
    path: ["orderNumberFormat"],
  });

// ---------------------------------------------------------------------------
// Quantity conversion (§5.1: boxes auto-convert to units)
// ---------------------------------------------------------------------------

export interface PackingInfo {
  unitsPerBox: number;
  unitsPerBag: number | null;
}

/** Convert an entered quantity into units, using the product's packing. */
export function toUnits(
  qty: number,
  enteredAs: (typeof ENTERED_AS)[number],
  packing: PackingInfo,
): number {
  switch (enteredAs) {
    case "BOXES":
      return qty * Math.max(1, packing.unitsPerBox);
    case "BAGS":
      return qty * Math.max(1, packing.unitsPerBag ?? packing.unitsPerBox);
    case "UNITS":
    default:
      return qty;
  }
}

/** Whole boxes a unit count fills, rounded up (used for picking summaries). */
export function unitsToBoxes(units: number, unitsPerBox: number): number {
  if (unitsPerBox <= 0) return 0;
  return Math.ceil(units / unitsPerBox);
}
