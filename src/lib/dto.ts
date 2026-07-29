import type { Role } from "@/db/schema";
import { canSeeCost, canSeeSalePrices, canSeeStockValue } from "@/lib/permissions";

/**
 * Role-scoped projections (§2.2, and the Phase 1 acceptance test:
 * "verify the warehouseman sees no prices anywhere INCLUDING raw API
 * responses").
 *
 * The rule this module enforces is stricter than hiding a column: a field the
 * role may not see is **absent from the object**, so it cannot appear in a
 * server-component payload, a Server Action return value, or an export.
 *
 * Everything that carries money out of the server should pass through here.
 * `dto.test.ts` walks the results recursively and fails if any money-ish key
 * survives for a role that must not see it.
 */

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** The fields every role may see. */
export interface ProductPublicFields {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unitsPerBox: number;
  unitsPerBag: number | null;
  boxVolumeM3: string;
  bagVolumeM3: string | null;
  weightKg: string;
  weightBasis: "UNIT" | "BOX";
  dimLengthCm: string;
  dimWidthCm: string;
  dimHeightCm: string;
  dimsBasis: "UNIT" | "BOX";
  status: "ACTIVE" | "ARCHIVED";
  minStock: number | null;
  createdAt: Date;
  mainImageUrl: string | null;
}

export interface ProductMoneyFields {
  costPriceCents: number;
  marketPriceCents: number;
  exportPriceCents: number;
}

export type ProductSource = ProductPublicFields & ProductMoneyFields;

/**
 * A product as a given role may see it. Money fields are optional in the type
 * *and* genuinely missing at runtime — a template that reads
 * `product.costPriceCents` for a warehouseman gets `undefined`, not a number.
 */
export type ProductView = ProductPublicFields & Partial<ProductMoneyFields>;

export function toProductView(source: ProductSource, role: Role): ProductView {
  const {
    costPriceCents,
    marketPriceCents,
    exportPriceCents,
    ...publicFields
  } = source;

  const view: ProductView = { ...publicFields };
  if (canSeeCost(role)) {
    view.costPriceCents = costPriceCents;
  }
  if (canSeeSalePrices(role)) {
    view.marketPriceCents = marketPriceCents;
    view.exportPriceCents = exportPriceCents;
  }
  return view;
}

// ---------------------------------------------------------------------------
// Stock rows
// ---------------------------------------------------------------------------

export interface StockPublicFields {
  productId: string;
  sku: string;
  name: string;
  categoryName: string | null;
  mainImageUrl: string | null;
  unitsPerBox: number;
  onHand: number;
  reserved: number;
  available: number;
  minStock: number | null;
  belowMinimum: boolean;
  daysInWarehouse: number | null;
  lastSaleDate: string | null;
  daysSinceSale: number | null;
  movement: MovementStatus;
}

export interface StockValueFields {
  valueAtCostCents: number;
  valueAtMarketCents: number;
}

export type StockSource = StockPublicFields & StockValueFields;
export type StockView = StockPublicFields & Partial<StockValueFields>;

export type MovementStatus = "NORMAL" | "SLOW" | "FROZEN";

export function toStockView(source: StockSource, role: Role): StockView {
  const { valueAtCostCents, valueAtMarketCents, ...publicFields } = source;
  const view: StockView = { ...publicFields };
  if (canSeeStockValue(role)) {
    view.valueAtCostCents = valueAtCostCents;
    view.valueAtMarketCents = valueAtMarketCents;
  }
  return view;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface OrderLinePublicFields {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unitsPerBox: number;
  qtyOrderedUnits: number;
  enteredAs: "UNITS" | "BOXES" | "BAGS";
  enteredQty: number;
  reservedQty: number;
  shortfall: number;
  picked: boolean;
  /** Availability at the moment of reading, for the §7.1 colour coding. */
  availableNow: number;
}

export interface OrderLineMoneyFields {
  unitPriceCents: number;
  basePriceSnapshotCents: number;
  lineTotalCents: number;
}

export type OrderLineSource = OrderLinePublicFields & OrderLineMoneyFields;
export type OrderLineView = OrderLinePublicFields & Partial<OrderLineMoneyFields>;

export function toOrderLineView(
  source: OrderLineSource,
  role: Role,
): OrderLineView {
  const {
    unitPriceCents,
    basePriceSnapshotCents,
    lineTotalCents,
    ...publicFields
  } = source;
  const view: OrderLineView = { ...publicFields };
  // Sale prices, not cost: a salesperson may see these, a warehouseman may not.
  if (canSeeSalePrices(role)) {
    view.unitPriceCents = unitPriceCents;
    view.basePriceSnapshotCents = basePriceSnapshotCents;
    view.lineTotalCents = lineTotalCents;
  }
  return view;
}

/** Strip the total from an order header for roles without price access. */
export function toOrderTotal(
  totalCents: number,
  role: Role,
): number | undefined {
  return canSeeSalePrices(role) ? totalCents : undefined;
}

// ---------------------------------------------------------------------------
// Leak detection (used by the tests and available as a runtime assertion)
// ---------------------------------------------------------------------------

/**
 * Key fragments that must never reach a role lacking the matching permission.
 * Deliberately broad — a new field called `marginCents` or `profitCents` is
 * caught by the substring rule without anyone remembering to update a list.
 */
const COST_KEYS = ["cost", "margin", "profit"];
const PRICE_KEYS = ["price", "total", "revenue", "value", "amount"];
const EXPENSE_KEYS = ["expense"];

function forbiddenFragments(role: Role): string[] {
  const out: string[] = [];
  if (!canSeeCost(role)) out.push(...COST_KEYS, ...EXPENSE_KEYS);
  if (!canSeeSalePrices(role)) out.push(...PRICE_KEYS);
  return out;
}

/**
 * Walk a payload and collect every key path a role must not have received.
 * An empty array means the payload is safe for that role.
 */
export function findForbiddenKeys(payload: unknown, role: Role): string[] {
  const fragments = forbiddenFragments(role);
  if (fragments.length === 0) return [];

  const hits: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (value: unknown, path: string) => {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (value instanceof Date) return;

    for (const [key, child] of Object.entries(value)) {
      const lower = key.toLowerCase();
      const childPath = path ? `${path}.${key}` : key;
      if (fragments.some((f) => lower.includes(f))) {
        hits.push(childPath);
      }
      walk(child, childPath);
    }
  };

  walk(payload, "");
  return hits;
}
