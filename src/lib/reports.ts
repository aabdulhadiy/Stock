import "server-only";
import { and, eq, gte, lte, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { customers, locations, products, saleItems, sales, users } from "@/db/schema";
import type { DateRange } from "@/lib/date-range";

/**
 * Reporting queries (spec 4.5). Two flavours:
 *  - Cash position is sale-level: how much UZS and USD were physically collected
 *    per shop, kept separate (never merged).
 *  - Performance/discount reports are item-level, expressed in a UZS-equivalent
 *    so cross-currency comparisons stay apples-to-apples. Each line's UZS value
 *    uses the sale's own snapshotted exchange rate.
 * All exclude VOIDED sales and honor an optional shop scope (managers see only
 * their own shop).
 */

interface Scope {
  range: DateRange;
  shopId?: string;
}

/** Common WHERE: completed sales within the range, optionally one shop. */
function saleConds(scope: Scope): SQL[] {
  const conds: SQL[] = [
    eq(sales.status, "COMPLETED"),
    gte(sales.createdAt, scope.range.from),
    lte(sales.createdAt, scope.range.to),
  ];
  if (scope.shopId) conds.push(eq(sales.shopId, scope.shopId));
  return conds;
}

// Per-line UZS-equivalent of a money column, using the sale's snapshot rate.
function lineUzs(col: AnyColumn) {
  return sql<number>`coalesce(sum(case when ${sales.currency} = 'UZS'
      then ${col} * ${saleItems.quantity}
      else ${col} * ${saleItems.quantity} * ${sales.exchangeRateUsed} end), 0)`;
}

const unitsSum = sql<number>`coalesce(sum(${saleItems.quantity}), 0)`;
const saleCount = sql<number>`count(distinct ${sales.id})`;

// ---------------------------------------------------------------------------
// Cash Position Dashboard — per shop, UZS and USD collected, kept separate.
// ---------------------------------------------------------------------------
export interface CashRow {
  shopId: string;
  shopName: string;
  uzs: number;
  usd: number;
}

export async function cashPosition(scope: Scope): Promise<CashRow[]> {
  const rows = await db
    .select({
      shopId: sales.shopId,
      shopName: locations.name,
      currency: sales.currency,
      total: sql<number>`coalesce(sum(${sales.totalAmount}), 0)`,
    })
    .from(sales)
    .innerJoin(locations, eq(locations.id, sales.shopId))
    .where(and(...saleConds(scope)))
    .groupBy(sales.shopId, locations.name, sales.currency);

  const map = new Map<string, CashRow>();
  for (const r of rows) {
    const entry =
      map.get(r.shopId) ?? { shopId: r.shopId, shopName: r.shopName, uzs: 0, usd: 0 };
    if (r.currency === "UZS") entry.uzs += Number(r.total);
    else entry.usd += Number(r.total);
    map.set(r.shopId, entry);
  }
  return [...map.values()].sort((a, b) => a.shopName.localeCompare(b.shopName));
}

// ---------------------------------------------------------------------------
// Sales performance
// ---------------------------------------------------------------------------
export interface PerfRow {
  id: string;
  label: string;
  revenueUzs: number;
  units: number;
  sales: number;
}

export async function salesByShop(scope: Scope): Promise<PerfRow[]> {
  const rows = await db
    .select({
      id: sales.shopId,
      label: locations.name,
      revenueUzs: lineUzs(saleItems.actualPrice),
      units: unitsSum,
      sales: saleCount,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .innerJoin(locations, eq(locations.id, sales.shopId))
    .where(and(...saleConds(scope)))
    .groupBy(sales.shopId, locations.name)
    .orderBy(sql`3 desc`);
  return normalize(rows);
}

export async function salesByManager(scope: Scope): Promise<PerfRow[]> {
  const rows = await db
    .select({
      id: sales.salesManagerId,
      label: users.name,
      revenueUzs: lineUzs(saleItems.actualPrice),
      units: unitsSum,
      sales: saleCount,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .innerJoin(users, eq(users.id, sales.salesManagerId))
    .where(and(...saleConds(scope)))
    .groupBy(sales.salesManagerId, users.name)
    .orderBy(sql`3 desc`);
  return normalize(rows);
}

export async function salesByProduct(scope: Scope): Promise<PerfRow[]> {
  const rows = await db
    .select({
      id: saleItems.productId,
      label: products.name,
      revenueUzs: lineUzs(saleItems.actualPrice),
      units: unitsSum,
      sales: saleCount,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .innerJoin(products, eq(products.id, saleItems.productId))
    .where(and(...saleConds(scope)))
    .groupBy(saleItems.productId, products.name)
    .orderBy(sql`3 desc`);
  return normalize(rows);
}

export async function salesByCustomer(scope: Scope): Promise<PerfRow[]> {
  const rows = await db
    .select({
      id: sql<string>`coalesce(${sales.customerId}::text, 'one-time')`,
      label: sql<string>`coalesce(${customers.name}, 'One-time / Other')`,
      revenueUzs: lineUzs(saleItems.actualPrice),
      units: unitsSum,
      sales: saleCount,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(and(...saleConds(scope)))
    .groupBy(sql`1`, sql`2`)
    .orderBy(sql`3 desc`);
  return normalize(rows);
}

function normalize(
  rows: { id: string; label: string | null; revenueUzs: unknown; units: unknown; sales: unknown }[],
): PerfRow[] {
  return rows.map((r) => ({
    id: r.id,
    label: r.label ?? "—",
    revenueUzs: Math.round(Number(r.revenueUzs)),
    units: Number(r.units),
    sales: Number(r.sales),
  }));
}

// ---------------------------------------------------------------------------
// Discount / markdown variance (suggested vs actual), by manager.
// ---------------------------------------------------------------------------
export interface VarianceRow {
  id: string;
  label: string;
  suggestedUzs: number;
  actualUzs: number;
  varianceUzs: number; // actual - suggested; negative = discount given
}

export async function discountByManager(scope: Scope): Promise<VarianceRow[]> {
  const rows = await db
    .select({
      id: sales.salesManagerId,
      label: users.name,
      suggestedUzs: lineUzs(saleItems.suggestedPrice),
      actualUzs: lineUzs(saleItems.actualPrice),
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .innerJoin(users, eq(users.id, sales.salesManagerId))
    .where(and(...saleConds(scope)))
    .groupBy(sales.salesManagerId, users.name);

  return rows
    .map((r) => {
      const suggestedUzs = Math.round(Number(r.suggestedUzs));
      const actualUzs = Math.round(Number(r.actualUzs));
      return {
        id: r.id,
        label: r.label ?? "—",
        suggestedUzs,
        actualUzs,
        varianceUzs: actualUzs - suggestedUzs,
      };
    })
    .sort((a, b) => a.varianceUzs - b.varianceUzs);
}
