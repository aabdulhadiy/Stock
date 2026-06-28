import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, closeDb } from "@/db";
import { products, locations, stockBalances, stockMovements } from "@/db/schema";
import { applyMovement, getOnHand, recomputeBalances, InsufficientStockError } from "./stock";

/**
 * Integration test for the ledger invariant against the live dev database.
 * Creates a throwaway product, exercises stock-in / transfer / over-transfer,
 * and verifies derived balances + isActive. Cleans up after itself.
 */

const TEST_SKU = "__TEST_SKU_LEDGER__";

async function cleanup() {
  const rows = await db.select().from(products).where(eq(products.sku, TEST_SKU));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(stockMovements).where(inArray(stockMovements.productId, ids));
    await db.delete(stockBalances).where(inArray(stockBalances.productId, ids));
    await db.delete(products).where(inArray(products.id, ids));
  }
}

after(async () => {
  await cleanup();
  await closeDb();
});

test("ledger: stock-in, transfer, over-transfer guard, isActive", async () => {
  await cleanup();
  const warehouse = (await db.select().from(locations).where(eq(locations.type, "WAREHOUSE")))[0];
  const shops = await db.select().from(locations).where(eq(locations.type, "SHOP"));
  const shop = shops[0];
  assert.ok(warehouse && shop, "seed locations must exist");

  const [product] = await db
    .insert(products)
    .values({ name: "Ledger Test Toy", sku: TEST_SKU, type: "NATIONAL", suggestedPriceUzs: 1000 })
    .returning();
  assert.equal(product.isActive, false, "new product starts inactive (0 stock)");

  // Stock-in 100 into warehouse.
  await applyMovement({
    productId: product.id,
    quantity: 100,
    fromLocationId: null,
    toLocationId: warehouse.id,
    type: "STOCK_IN",
  });
  assert.equal(await getOnHand(product.id, warehouse.id), 100);

  // Transfer 30 warehouse -> shop.
  await applyMovement({
    productId: product.id,
    quantity: 30,
    fromLocationId: warehouse.id,
    toLocationId: shop.id,
    type: "TRANSFER",
  });
  assert.equal(await getOnHand(product.id, warehouse.id), 70);
  assert.equal(await getOnHand(product.id, shop.id), 30);

  // isActive should now be true.
  const afterStock = (await db.select().from(products).where(eq(products.id, product.id)))[0];
  assert.equal(afterStock.isActive, true);

  // Over-transfer must be rejected and leave balances untouched.
  await assert.rejects(
    () =>
      applyMovement({
        productId: product.id,
        quantity: 999,
        fromLocationId: warehouse.id,
        toLocationId: shop.id,
        type: "TRANSFER",
      }),
    (err) => err instanceof InsufficientStockError,
  );
  assert.equal(await getOnHand(product.id, warehouse.id), 70, "balance unchanged after failed transfer");

  // recomputeBalances must reconcile to the same numbers.
  await recomputeBalances();
  assert.equal(await getOnHand(product.id, warehouse.id), 70);
  assert.equal(await getOnHand(product.id, shop.id), 30);
});
