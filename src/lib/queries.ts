import "server-only";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  customers,
  districts,
  exchangeRates,
  locations,
  products,
  regions,
  saleItems,
  sales,
  stockBalances,
  stockMovements,
  users,
} from "@/db/schema";

/** Shared server-side read queries. */

export async function getLocations() {
  return db.select().from(locations).orderBy(locations.type, locations.name);
}

export async function getWarehouse() {
  const [w] = await db
    .select()
    .from(locations)
    .where(eq(locations.type, "WAREHOUSE"))
    .limit(1);
  return w;
}

export async function getShops() {
  return db
    .select()
    .from(locations)
    .where(eq(locations.type, "SHOP"))
    .orderBy(locations.name);
}

/** Total on-hand units per location (across all products). */
export async function getStockByLocation() {
  const rows = await db
    .select({
      locationId: locations.id,
      name: locations.name,
      type: locations.type,
      units: sql<number>`coalesce(sum(${stockBalances.quantity}), 0)::int`,
    })
    .from(locations)
    .leftJoin(stockBalances, eq(stockBalances.locationId, locations.id))
    .groupBy(locations.id, locations.name, locations.type)
    .orderBy(locations.type, locations.name);
  return rows;
}

export async function getProductCounts() {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${products.isActive})::int`,
    })
    .from(products);
  return row ?? { total: 0, active: 0 };
}

export async function getTotalUnits() {
  const [row] = await db
    .select({ units: sql<number>`coalesce(sum(${stockBalances.quantity}), 0)::int` })
    .from(stockBalances);
  return row?.units ?? 0;
}

export interface RecentMovement {
  id: string;
  type: string;
  quantity: number;
  productName: string;
  fromName: string | null;
  toName: string | null;
  by: string | null;
  createdAt: Date;
}

export async function getRecentMovements(limit = 10): Promise<RecentMovement[]> {
  const fromLoc = alias(locations, "from_loc");
  const toLoc = alias(locations, "to_loc");
  const rows = await db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      productName: products.name,
      fromName: fromLoc.name,
      toName: toLoc.name,
      by: users.name,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .innerJoin(products, eq(products.id, stockMovements.productId))
    .leftJoin(fromLoc, eq(fromLoc.id, stockMovements.fromLocationId))
    .leftJoin(toLoc, eq(toLoc.id, stockMovements.toLocationId))
    .leftJoin(users, eq(users.id, stockMovements.createdById))
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit);
  return rows;
}

/** Products with their on-hand quantity at a specific location. */
export async function getProductsWithStockAt(locationId: string) {
  return db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      type: products.type,
      suggestedPriceUzs: products.suggestedPriceUzs,
      unitsPerBox: products.unitsPerBox,
      isActive: products.isActive,
      onHand: sql<number>`coalesce(${stockBalances.quantity}, 0)::int`,
    })
    .from(products)
    .leftJoin(
      stockBalances,
      and(eq(stockBalances.productId, products.id), eq(stockBalances.locationId, locationId)),
    )
    .orderBy(products.name);
}

/** All products with total on-hand across every location. */
export async function getProductsList() {
  return db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      type: products.type,
      suggestedPriceUzs: products.suggestedPriceUzs,
      costPriceUzs: products.costPriceUzs,
      unitsPerBox: products.unitsPerBox,
      isActive: products.isActive,
      totalOnHand: sql<number>`coalesce(sum(${stockBalances.quantity}), 0)::int`,
    })
    .from(products)
    .leftJoin(stockBalances, eq(stockBalances.productId, products.id))
    .groupBy(products.id)
    .orderBy(products.name);
}

export async function getUsersList() {
  const shop = alias(locations, "shop");
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      shopName: shop.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(shop, eq(shop.id, users.shopId))
    .orderBy(users.name);
}

export async function getProductById(id: string) {
  const [p] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return p;
}

// ---------------------------------------------------------------------------
// Phase 2: exchange rate, customers, sales
// ---------------------------------------------------------------------------

/** The currently effective exchange rate (UZS per 1 USD) as a number. */
export async function getCurrentRate(): Promise<number> {
  const [row] = await db
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.effectiveFrom))
    .limit(1);
  return row ? Number(row.rate) : 0;
}

export async function getExchangeRateHistory() {
  return db
    .select({
      id: exchangeRates.id,
      rate: exchangeRates.rate,
      effectiveFrom: exchangeRates.effectiveFrom,
      setBy: users.name,
    })
    .from(exchangeRates)
    .leftJoin(users, eq(users.id, exchangeRates.setById))
    .orderBy(desc(exchangeRates.effectiveFrom))
    .limit(50);
}

/** Regions with their districts, for cascading selects. */
export async function getRegionTree() {
  const regs = await db.select().from(regions).orderBy(regions.name);
  const dists = await db.select().from(districts).orderBy(districts.name);
  return regs.map((r) => ({
    id: r.id,
    name: r.name,
    districts: dists.filter((d) => d.regionId === r.id).map((d) => ({ id: d.id, name: d.name })),
  }));
}

/** Search customers by name or phone (empty query returns recent customers). */
export async function searchCustomers(query: string, limit = 20) {
  const q = query.trim();
  const base = db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      regionName: regions.name,
      districtName: districts.name,
      notes: customers.notes,
    })
    .from(customers)
    .leftJoin(regions, eq(regions.id, customers.regionId))
    .leftJoin(districts, eq(districts.id, customers.districtId));
  const rows = q
    ? await base
        .where(or(ilike(customers.name, `%${q}%`), ilike(customers.phone, `%${q}%`)))
        .orderBy(customers.name)
        .limit(limit)
    : await base.orderBy(desc(customers.createdAt)).limit(limit);
  return rows;
}

export async function getCustomerById(id: string) {
  const [c] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return c;
}

/** Products available to sell at a shop (on-hand > 0). */
export async function getShopStockProducts(shopId: string) {
  const all = await getProductsWithStockAt(shopId);
  return all.filter((p) => p.onHand > 0);
}

export interface SalesFilter {
  shopId?: string;
  salesManagerId?: string;
}

/** Sales list with shop, manager and customer labels. */
export async function getSales(filter: SalesFilter = {}) {
  const conds = [];
  if (filter.shopId) conds.push(eq(sales.shopId, filter.shopId));
  if (filter.salesManagerId) conds.push(eq(sales.salesManagerId, filter.salesManagerId));

  return db
    .select({
      id: sales.id,
      createdAt: sales.createdAt,
      currency: sales.currency,
      totalAmount: sales.totalAmount,
      totalAmountUzs: sales.totalAmountUzs,
      status: sales.status,
      shopName: locations.name,
      managerName: users.name,
      customerName: customers.name,
      customerNote: sales.customerNote,
    })
    .from(sales)
    .leftJoin(locations, eq(locations.id, sales.shopId))
    .leftJoin(users, eq(users.id, sales.salesManagerId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(sales.createdAt))
    .limit(200);
}

/** A single sale with its line items, for the detail / summary view. */
export async function getSaleDetail(id: string) {
  const [sale] = await db
    .select({
      id: sales.id,
      createdAt: sales.createdAt,
      shopId: sales.shopId,
      shopName: locations.name,
      salesManagerId: sales.salesManagerId,
      managerName: users.name,
      customerId: sales.customerId,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerNote: sales.customerNote,
      currency: sales.currency,
      exchangeRateUsed: sales.exchangeRateUsed,
      totalAmount: sales.totalAmount,
      totalAmountUzs: sales.totalAmountUzs,
      status: sales.status,
    })
    .from(sales)
    .leftJoin(locations, eq(locations.id, sales.shopId))
    .leftJoin(users, eq(users.id, sales.salesManagerId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(eq(sales.id, id))
    .limit(1);
  if (!sale) return null;

  const items = await db
    .select({
      id: saleItems.id,
      productId: saleItems.productId,
      productName: products.name,
      quantity: saleItems.quantity,
      suggestedPrice: saleItems.suggestedPrice,
      actualPrice: saleItems.actualPrice,
    })
    .from(saleItems)
    .innerJoin(products, eq(products.id, saleItems.productId))
    .where(eq(saleItems.saleId, id));

  return { sale, items };
}

/** Full stock matrix: each product's quantity at every location. */
export async function getStockMatrix() {
  const locs = await getLocations();
  const balances = await db
    .select({
      productId: stockBalances.productId,
      locationId: stockBalances.locationId,
      quantity: stockBalances.quantity,
    })
    .from(stockBalances);
  const prods = await db.select().from(products).orderBy(products.name);

  const map = new Map<string, Map<string, number>>();
  for (const b of balances) {
    if (!map.has(b.productId)) map.set(b.productId, new Map());
    map.get(b.productId)!.set(b.locationId, b.quantity);
  }
  return { locations: locs, products: prods, balanceFor: (p: string, l: string) => map.get(p)?.get(l) ?? 0 };
}
