import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, closeDb } from "@/db";
import {
  products,
  locations,
  users,
  sales,
  saleItems,
  stockBalances,
  stockMovements,
} from "@/db/schema";
import { applyMovement, getOnHand } from "./stock";
import { createSale, voidSale, SaleError } from "./sales";
import type { SessionUser } from "./session";

const TEST_SKU = "__TEST_SKU_SALES__";

async function cleanup() {
  const rows = await db.select().from(products).where(eq(products.sku, TEST_SKU));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    const saleRows = await db
      .select({ id: sales.id })
      .from(sales)
      .innerJoin(saleItems, eq(saleItems.saleId, sales.id))
      .where(inArray(saleItems.productId, ids));
    const saleIds = [...new Set(saleRows.map((s) => s.id))];
    await db.delete(stockMovements).where(inArray(stockMovements.productId, ids));
    if (saleIds.length) {
      await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
      await db.delete(sales).where(inArray(sales.id, saleIds));
    }
    await db.delete(stockBalances).where(inArray(stockBalances.productId, ids));
    await db.delete(products).where(inArray(products.id, ids));
  }
}

after(async () => {
  await cleanup();
  await closeDb();
});

test("sales: create UZS + USD sales, void restores stock, over-sell rolls back", async () => {
  await cleanup();
  const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
  const [shop] = await db.select().from(locations).where(eq(locations.type, "SHOP")).limit(1);
  assert.ok(admin && shop, "seed admin + shop must exist");

  const actor: SessionUser = {
    sub: admin.id,
    email: admin.email,
    name: admin.name,
    role: "ADMIN",
    shopId: null,
  };

  const [product] = await db
    .insert(products)
    .values({ name: "Sale Test Toy", sku: TEST_SKU, type: "NATIONAL", suggestedPriceUzs: 100000 })
    .returning();

  // Put 100 pcs into the shop directly for the test.
  await applyMovement({
    productId: product.id,
    quantity: 100,
    fromLocationId: null,
    toLocationId: shop.id,
    type: "STOCK_IN",
  });
  assert.equal(await getOnHand(product.id, shop.id), 100);

  // --- UZS sale: 5 @ 100000 ---
  const uzsSaleId = await createSale(actor, {
    shopId: shop.id,
    currency: "UZS",
    customerMode: "other",
    customerNote: "Walk-in",
    items: [{ productId: product.id, quantity: 5, actualPrice: 100000 }],
  });
  assert.equal(await getOnHand(product.id, shop.id), 95, "UZS sale deducts 5");
  const [uzsSale] = await db.select().from(sales).where(eq(sales.id, uzsSaleId));
  assert.equal(Number(uzsSale.totalAmount), 500000);
  assert.equal(Number(uzsSale.totalAmountUzs), 500000);
  assert.equal(Number(uzsSale.exchangeRateUsed) > 0, true);

  // --- USD sale: 2 @ 7.94 (suggested from 100000 / rate) ---
  const rate = Number(uzsSale.exchangeRateUsed);
  const usdPrice = Math.round((100000 / rate) * 100) / 100;
  const usdSaleId = await createSale(actor, {
    shopId: shop.id,
    currency: "USD",
    customerMode: "other",
    items: [{ productId: product.id, quantity: 2, actualPrice: usdPrice }],
  });
  assert.equal(await getOnHand(product.id, shop.id), 93, "USD sale deducts 2 more");
  const [usdSale] = await db.select().from(sales).where(eq(sales.id, usdSaleId));
  assert.equal(Number(usdSale.totalAmount), Math.round(usdPrice * 2 * 100) / 100);
  assert.equal(Number(usdSale.totalAmountUzs), Math.round(usdPrice * 2 * rate));

  // --- Void the USD sale: stock restored, status flips ---
  await voidSale(actor, usdSaleId);
  assert.equal(await getOnHand(product.id, shop.id), 95, "void restores 2");
  const [voided] = await db.select().from(sales).where(eq(sales.id, usdSaleId));
  assert.equal(voided.status, "VOIDED");

  // Double void is refused.
  await assert.rejects(() => voidSale(actor, usdSaleId), (e) => e instanceof SaleError);

  // --- Over-sell rolls back entirely (no sale row, no deduction) ---
  const before = await getOnHand(product.id, shop.id);
  const salesBefore = (await db.select().from(sales)).length;
  await assert.rejects(
    () =>
      createSale(actor, {
        shopId: shop.id,
        currency: "UZS",
        customerMode: "other",
        items: [{ productId: product.id, quantity: 99999, actualPrice: 100000 }],
      }),
  );
  assert.equal(await getOnHand(product.id, shop.id), before, "stock unchanged after failed sale");
  assert.equal((await db.select().from(sales)).length, salesBefore, "no sale row created");
});
