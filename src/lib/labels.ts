import type {
  Channel,
  CountStatus,
  EnteredAs,
  ExpenseType,
  Locale,
  MeasureBasis,
  MovementType,
  OrderStatus,
  PaymentMethod,
  PriceType,
  ProductStatus,
  Role,
} from "@/db/schema";
import type { MovementStatus } from "@/lib/dto";
import type { BadgeColor } from "@/components/ui";
import type { T, TranslationKey } from "@/i18n";

/**
 * Enum -> translation key, plus the badge colour each state should carry.
 * Centralised so "Picking" is spelled the same way, in every language and in
 * the same amber, on every screen that shows it.
 */

export const roleKey = (r: Role): TranslationKey => `role.${r}` as TranslationKey;
export const orderStatusKey = (s: OrderStatus): TranslationKey =>
  `order.status.${s}` as TranslationKey;
export const priceTypeKey = (p: PriceType): TranslationKey =>
  `order.priceType.${p}` as TranslationKey;
export const paymentMethodKey = (m: PaymentMethod): TranslationKey =>
  `order.paymentMethod.${m}` as TranslationKey;
export const channelKey = (c: Channel): TranslationKey =>
  `customer.channel.${c}` as TranslationKey;
export const productStatusKey = (s: ProductStatus): TranslationKey =>
  `product.status.${s}` as TranslationKey;
export const basisKey = (b: MeasureBasis): TranslationKey =>
  `product.basis.${b}` as TranslationKey;
export const enteredAsKey = (e: EnteredAs): TranslationKey =>
  `order.enteredAs.${e}` as TranslationKey;
export const movementTypeKey = (m: MovementType): TranslationKey =>
  `stock.movementType.${m}` as TranslationKey;
export const movementStatusKey = (m: MovementStatus): TranslationKey =>
  `stock.movement.${m}` as TranslationKey;
export const countStatusKey = (s: CountStatus): TranslationKey =>
  `count.status.${s}` as TranslationKey;
export const expenseTypeKey = (t: ExpenseType): TranslationKey =>
  `expcat.type.${t}` as TranslationKey;
export const gradeKey = (g: CustomerGrade): TranslationKey =>
  `customer.grade.${g}` as TranslationKey;
export const localeLabelKey = (_l: Locale): TranslationKey => "common.language";

export type CustomerGrade = "A" | "B" | "C" | "D";

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export const ORDER_STATUS_COLOR: Record<OrderStatus, BadgeColor> = {
  NEW: "blue",
  PICKING: "amber",
  READY: "indigo",
  SHIPPED: "green",
  CANCELLED: "slate",
};

/** §4.3: Normal green, Slow yellow, Frozen red. */
export const MOVEMENT_COLOR: Record<MovementStatus, BadgeColor> = {
  NORMAL: "green",
  SLOW: "amber",
  FROZEN: "red",
};

export const COUNT_STATUS_COLOR: Record<CountStatus, BadgeColor> = {
  DRAFT: "slate",
  SUBMITTED: "amber",
  APPROVED: "green",
  CANCELLED: "slate",
};

export const GRADE_COLOR: Record<CustomerGrade, BadgeColor> = {
  A: "green",
  B: "blue",
  C: "amber",
  D: "red",
};

export const MOVEMENT_TYPE_COLOR: Record<MovementType, BadgeColor> = {
  RECEIPT: "green",
  SHIPMENT: "blue",
  ADJUSTMENT: "amber",
  RETURN: "indigo",
};

// ---------------------------------------------------------------------------
// Availability colours (§7.1)
// ---------------------------------------------------------------------------

export type Availability = "FULL" | "PARTIAL" | "NONE";

/**
 * §7.1: green when the whole line can be met, yellow when only part of it can,
 * red when nothing is available.
 */
export function availabilityOf(needed: number, available: number): Availability {
  if (available <= 0) return "NONE";
  if (available >= needed) return "FULL";
  return "PARTIAL";
}

export const AVAILABILITY_COLOR: Record<Availability, BadgeColor> = {
  FULL: "green",
  PARTIAL: "amber",
  NONE: "red",
};

export const AVAILABILITY_KEY: Record<Availability, TranslationKey> = {
  FULL: "pick.full",
  PARTIAL: "pick.partial",
  NONE: "pick.unavailable",
};

/** Row tint for the picking list, so the whole line reads as green/yellow/red. */
export const AVAILABILITY_ROW: Record<Availability, string> = {
  FULL: "bg-green-50/70",
  PARTIAL: "bg-amber-50/70",
  NONE: "bg-red-50/70",
};

// ---------------------------------------------------------------------------
// Payment terms (§5.4)
// ---------------------------------------------------------------------------

export function paymentTermLabel(t: T, days: number): string {
  return days === 0 ? t("order.term.immediate") : t("order.term.days", { days });
}

/**
 * §4.3 classification. The measure is days since the last sale; for a product
 * that has never sold there is no such date, so its age in the warehouse (days
 * since first receipt) stands in — otherwise a brand-new product received
 * today would be flagged Frozen on day one, and every never-sold product would
 * be flagged identically regardless of how long it had actually been sitting.
 *
 * With neither date there is no stock and no history, so nothing to flag.
 */
export function movementStatusFor(
  daysSinceSale: number | null,
  daysInWarehouse: number | null,
  slowDays: number,
  frozenDays: number,
): MovementStatus {
  const age = daysSinceSale ?? daysInWarehouse;
  if (age === null) return "NORMAL";
  if (age >= frozenDays) return "FROZEN";
  if (age > slowDays) return "SLOW";
  return "NORMAL";
}
