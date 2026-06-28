import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  locations,
  products,
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
