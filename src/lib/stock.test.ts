import test from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, closeDb } from "@/db";
import {
  categories,
  customers,
  orderItems,
  orders,
  productStock,
  products,
  stockMovements,
  users,
} from "@/db/schema";
import {
  applyMovement,
  auditStockInvariants,
  consumeReservationsOnShip,
  getShortfalls,
  getStock,
  ensureStockRow,
  recomputeStock,
  releaseOrderReservations,
  reserveForOrder,
  adjustLineReservation,
  InsufficientStockError,
} from "@/lib/stock";

/**
 * Integration tests for the ledger and the reservation engine (§6, BR-1…BR-9),
 * running against a real PostgreSQL — the row-level locking that BR-9 depends
 * on cannot be tested against a mock.
 *
 * Each test seeds its own products with a unique SKU prefix and cleans up
 * afterwards, so the suite is order-independent and re-runnable.
 */

const PREFIX = `TEST-${process.pid}-`;
let seq = 0;
const nextSku = () => `${PREFIX}${++seq}`;

const TODAY = "2026-07-29";

async function makeProduct(opts: { onHand?: number } = {}): Promise<string> {
  const [row] = await db
    .insert(products)
    .values({
      sku: nextSku(),
      name: "Test toy",
      unitsPerBox: 12,
      boxVolumeM3: "0.05",
      weightKg: "6.5",
      weightBasis: "BOX",
      dimLengthCm: "40",
      dimWidthCm: "30",
      dimHeightCm: "25",
      costPriceCents: 500,
      marketPriceCents: 900,
      exportPriceCents: 1100,
    })
    .returning({ id: products.id });

  await ensureStockRow(db, row.id);
  if (opts.onHand) {
    await db.transaction(async (tx) => {
      await applyMovement(tx, {
        productId: row.id,
        type: "RECEIPT",
        qtyUnits: opts.onHand!,
        movementDate: TODAY,
      });
    });
  }
  return row.id;
}

async function makeCustomer(): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({
      name: `Test customer ${nextSku()}`,
      phone: nextSku(),
      channel: "DOMESTIC",
      defaultPriceType: "MARKET",
    })
    .returning({ id: customers.id });
  return row.id;
}

async function makeOrder(
  customerId: string,
  lines: { productId: string; qty: number }[],
): Promise<string> {
  const [order] = await db
    .insert(orders)
    .values({
      number: `ORD-TEST-${nextSku()}`,
      customerId,
      priceType: "MARKET",
      status: "NEW",
      plannedShipDate: TODAY,
      paymentMethod: "CASH",
      paymentTermDays: 0,
    })
    .returning({ id: orders.id });

  for (const line of lines) {
    await db.insert(orderItems).values({
      orderId: order.id,
      productId: line.productId,
      qtyOrderedUnits: line.qty,
      enteredAs: "UNITS",
      enteredQty: line.qty,
      unitPriceCents: 900,
      basePriceSnapshotCents: 900,
    });
  }
  return order.id;
}

/** Move an order to PICKING the way the real acceptance action does. */
async function accept(orderId: string) {
  return db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ status: "PICKING", acceptedAt: new Date() })
      .where(eq(orders.id, orderId));
    return reserveForOrder(tx, orderId);
  });
}

test.after(async () => {
  const ids = await db
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.sku, Array.from({ length: seq }, (_, i) => `${PREFIX}${i + 1}`)));
  const productIds = ids.map((r) => r.id);

  const testOrders = await db.select({ id: orders.id }).from(orders);
  const orderIds = testOrders.map((o) => o.id);
  if (orderIds.length) {
    await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
  }
  if (productIds.length) {
    await db.delete(stockMovements).where(inArray(stockMovements.productId, productIds));
  }
  await db.delete(orders);
  await db.delete(customers);
  if (productIds.length) {
    await db.delete(productStock).where(inArray(productStock.productId, productIds));
    await db.delete(products).where(inArray(products.id, productIds));
  }
  await db.delete(categories);
  await db.delete(users);
  await closeDb();
});

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

test("on-hand is the sum of ledger movements", async () => {
  const p = await makeProduct();
  await db.transaction(async (tx) => {
    await applyMovement(tx, { productId: p, type: "RECEIPT", qtyUnits: 100, movementDate: TODAY });
  });
  await db.transaction(async (tx) => {
    await applyMovement(tx, { productId: p, type: "RECEIPT", qtyUnits: 50, movementDate: TODAY });
  });
  await db.transaction(async (tx) => {
    await applyMovement(tx, { productId: p, type: "ADJUSTMENT", qtyUnits: -20, movementDate: TODAY });
  });

  const stock = await getStock(p);
  assert.equal(stock.onHand, 130);
  assert.equal(stock.available, 130);
  assert.deepEqual(await auditStockInvariants(), []);
});

test("a movement may not drive on-hand negative", async () => {
  const p = await makeProduct({ onHand: 10 });
  await assert.rejects(
    () =>
      db.transaction(async (tx) => {
        await applyMovement(tx, {
          productId: p,
          type: "ADJUSTMENT",
          qtyUnits: -11,
          movementDate: TODAY,
        });
      }),
    InsufficientStockError,
  );
  assert.equal((await getStock(p)).onHand, 10);
});

test("a receipt records the last receipt date, a shipment the last sale date", async () => {
  const p = await makeProduct();
  await db.transaction(async (tx) => {
    await applyMovement(tx, {
      productId: p,
      type: "RECEIPT",
      qtyUnits: 40,
      movementDate: "2026-01-15",
    });
  });
  await db.transaction(async (tx) => {
    await applyMovement(tx, {
      productId: p,
      type: "SHIPMENT",
      qtyUnits: -10,
      movementDate: "2026-03-20",
    });
  });

  const [row] = await db
    .select()
    .from(productStock)
    .where(eq(productStock.productId, p));
  assert.equal(row.lastReceiptDate, "2026-01-15");
  assert.equal(row.lastSaleDate, "2026-03-20");
});

// ---------------------------------------------------------------------------
// BR-1 / BR-2 — reservation happens on acceptance, not on creation
// ---------------------------------------------------------------------------

test("BR-1: creating an order reserves nothing", async () => {
  const p = await makeProduct({ onHand: 100 });
  const c = await makeCustomer();
  await makeOrder(c, [{ productId: p, qty: 60 }]);

  const stock = await getStock(p);
  assert.equal(stock.reserved, 0);
  assert.equal(stock.available, 100);
});

test("BR-2: acceptance reserves min(ordered, available) and reports the shortfall", async () => {
  const p = await makeProduct({ onHand: 40 });
  const c = await makeCustomer();
  const o = await makeOrder(c, [{ productId: p, qty: 100 }]);

  const outcomes = await accept(o);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].reserved, 40);
  assert.equal(outcomes[0].shortfall, 60);

  const stock = await getStock(p);
  assert.equal(stock.onHand, 40);
  assert.equal(stock.reserved, 40);
  assert.equal(stock.available, 0);
  assert.deepEqual(await auditStockInvariants(), []);
});

test("BR-4: first accepted wins the stock, the second sees a shortfall", async () => {
  const p = await makeProduct({ onHand: 100 });
  const c = await makeCustomer();
  const first = await makeOrder(c, [{ productId: p, qty: 80 }]);
  const second = await makeOrder(c, [{ productId: p, qty: 80 }]);

  const a = await accept(first);
  const b = await accept(second);

  assert.equal(a[0].reserved, 80, "first accepted takes what it needs");
  assert.equal(a[0].shortfall, 0);
  assert.equal(b[0].reserved, 20, "second gets only the remainder");
  assert.equal(b[0].shortfall, 60);

  const stock = await getStock(p);
  assert.equal(stock.reserved, 100);
  assert.equal(stock.available, 0);
});

test("two lines of one order competing for the same product cannot double-reserve", async () => {
  const p = await makeProduct({ onHand: 50 });
  const c = await makeCustomer();
  const o = await makeOrder(c, [
    { productId: p, qty: 30 },
    { productId: p, qty: 30 },
  ]);

  const outcomes = await accept(o);
  const totalReserved = outcomes.reduce((s, x) => s + x.reserved, 0);
  assert.equal(totalReserved, 50, "the two lines share the 50 available units");
  assert.equal((await getStock(p)).reserved, 50);
  assert.deepEqual(await auditStockInvariants(), []);
});

// ---------------------------------------------------------------------------
// BR-9 — the hard concurrency requirement
// ---------------------------------------------------------------------------

test("BR-9: simultaneous acceptances can never over-reserve", async () => {
  const p = await makeProduct({ onHand: 100 });
  const c = await makeCustomer();
  const ids = await Promise.all(
    Array.from({ length: 6 }, () => makeOrder(c, [{ productId: p, qty: 40 }])),
  );

  // Fire all six acceptances at once; the stock row lock must serialise them.
  const results = await Promise.all(ids.map((id) => accept(id)));

  const totalReserved = results.flat().reduce((s, x) => s + x.reserved, 0);
  assert.equal(totalReserved, 100, "exactly the 100 physical units get reserved");

  const stock = await getStock(p);
  assert.equal(stock.reserved, 100);
  assert.equal(stock.available, 0, "available never goes negative");
  assert.deepEqual(
    await auditStockInvariants(),
    [],
    "cache still agrees with the ledger and the order lines",
  );
});

test("BR-9: concurrent multi-product acceptances do not deadlock", async () => {
  const p1 = await makeProduct({ onHand: 60 });
  const p2 = await makeProduct({ onHand: 60 });
  const c = await makeCustomer();

  // Lines are listed in opposite orders on purpose — the engine must still
  // acquire locks in a stable sequence.
  const a = await makeOrder(c, [
    { productId: p1, qty: 40 },
    { productId: p2, qty: 40 },
  ]);
  const b = await makeOrder(c, [
    { productId: p2, qty: 40 },
    { productId: p1, qty: 40 },
  ]);

  const [ra, rb] = await Promise.all([accept(a), accept(b)]);

  const reserved1 =
    (await getStock(p1)).reserved;
  const reserved2 = (await getStock(p2)).reserved;
  assert.equal(reserved1, 60);
  assert.equal(reserved2, 60);
  assert.equal(
    [...ra, ...rb].reduce((s, x) => s + x.reserved, 0),
    120,
  );
  assert.deepEqual(await auditStockInvariants(), []);
});

// ---------------------------------------------------------------------------
// BR-5 — explicit top-up after a receipt
// ---------------------------------------------------------------------------

test("BR-5: 'Reserve available' tops up to the remaining shortfall after a receipt", async () => {
  const p = await makeProduct({ onHand: 40 });
  const c = await makeCustomer();
  const o = await makeOrder(c, [{ productId: p, qty: 100 }]);

  await accept(o);
  assert.equal((await getStock(p)).reserved, 40);

  // Production delivers 45 more units.
  await db.transaction(async (tx) => {
    await applyMovement(tx, { productId: p, type: "RECEIPT", qtyUnits: 45, movementDate: TODAY });
  });

  // No silent re-reservation: reserved is unchanged until asked (BR-5).
  assert.equal((await getStock(p)).reserved, 40);
  assert.equal((await getStock(p)).available, 45);

  const outcomes = await db.transaction((tx) => reserveForOrder(tx, o));
  assert.equal(outcomes[0].reserved, 85);
  assert.equal(outcomes[0].shortfall, 15, "still short of the 100 ordered");
  assert.equal((await getStock(p)).available, 0);
});

test("BR-5: topping up never reserves beyond the ordered quantity", async () => {
  const p = await makeProduct({ onHand: 30 });
  const c = await makeCustomer();
  const o = await makeOrder(c, [{ productId: p, qty: 50 }]);
  await accept(o);

  await db.transaction(async (tx) => {
    await applyMovement(tx, { productId: p, type: "RECEIPT", qtyUnits: 500, movementDate: TODAY });
  });
  const outcomes = await db.transaction((tx) => reserveForOrder(tx, o));

  assert.equal(outcomes[0].reserved, 50);
  assert.equal(outcomes[0].shortfall, 0);
  assert.equal((await getStock(p)).reserved, 50);
});

// ---------------------------------------------------------------------------
// BR-7 — cancellation
// ---------------------------------------------------------------------------

test("BR-7: cancelling an accepted order restores availability immediately", async () => {
  const p = await makeProduct({ onHand: 100 });
  const c = await makeCustomer();
  const o = await makeOrder(c, [{ productId: p, qty: 70 }]);
  await accept(o);
  assert.equal((await getStock(p)).available, 30);

  const released = await db.transaction(async (tx) => {
    const n = await releaseOrderReservations(tx, o);
    await tx.update(orders).set({ status: "CANCELLED" }).where(eq(orders.id, o));
    return n;
  });

  assert.equal(released, 70);
  const stock = await getStock(p);
  assert.equal(stock.reserved, 0);
  assert.equal(stock.available, 100);
  assert.deepEqual(await auditStockInvariants(), []);
});

test("BR-7: cancelling a NEW order changes nothing", async () => {
  const p = await makeProduct({ onHand: 100 });
  const c = await makeCustomer();
  const o = await makeOrder(c, [{ productId: p, qty: 70 }]);

  const released = await db.transaction(async (tx) => {
    const n = await releaseOrderReservations(tx, o);
    await tx.update(orders).set({ status: "CANCELLED" }).where(eq(orders.id, o));
    return n;
  });

  assert.equal(released, 0);
  const stock = await getStock(p);
  assert.equal(stock.onHand, 100);
  assert.equal(stock.reserved, 0);
  assert.equal(stock.available, 100);
});

// ---------------------------------------------------------------------------
// BR-8 — editing an accepted order
// ---------------------------------------------------------------------------

test("BR-8: decreasing a line releases the difference", async () => {
  const p = await makeProduct({ onHand: 100 });
  const c = await makeCustomer();
  const o = await makeOrder(c, [{ productId: p, qty: 80 }]);
  await accept(o);

  const [line] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, o));

  await db.transaction(async (tx) => {
    await tx
      .update(orderItems)
      .set({ qtyOrderedUnits: 30, enteredQty: 30 })
      .where(eq(orderItems.id, line.id));
    await adjustLineReservation(tx, line.id, 30);
  });

  const stock = await getStock(p);
  assert.equal(stock.reserved, 30);
  assert.equal(stock.available, 70);
  assert.deepEqual(await auditStockInvariants(), []);
});

test("BR-8: increasing a line reserves the increase, short if stock runs out", async () => {
  const p = await makeProduct({ onHand: 50 });
  const c = await makeCustomer();
  const o = await makeOrder(c, [{ productId: p, qty: 20 }]);
  await accept(o);

  const [line] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, o));

  const held = await db.transaction(async (tx) => {
    await tx
      .update(orderItems)
      .set({ qtyOrderedUnits: 90, enteredQty: 90 })
      .where(eq(orderItems.id, line.id));
    return adjustLineReservation(tx, line.id, 90);
  });

  assert.equal(held, 50, "reserves only what the warehouse physically has");
  const stock = await getStock(p);
  assert.equal(stock.reserved, 50);
  assert.equal(stock.available, 0);
});

// ---------------------------------------------------------------------------
// BR-6 — shipping
// ---------------------------------------------------------------------------

test("BR-6: shipping consumes the reservation and decreases on-hand", async () => {
  const p = await makeProduct({ onHand: 100 });
  const c = await makeCustomer();
  const o = await makeOrder(c, [{ productId: p, qty: 60 }]);
  await accept(o);

  await db.transaction(async (tx) => {
    await consumeReservationsOnShip(tx, o, "2026-08-01", null);
    await tx
      .update(orders)
      .set({ status: "SHIPPED", actualShipDate: "2026-08-01" })
      .where(eq(orders.id, o));
  });

  const stock = await getStock(p);
  assert.equal(stock.onHand, 40, "60 units left the warehouse");
  assert.equal(stock.reserved, 0, "the reservation was consumed, not released");
  assert.equal(stock.available, 40);

  const movements = await db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.orderId, o));
  assert.equal(movements.length, 1);
  assert.equal(movements[0].type, "SHIPMENT");
  assert.equal(movements[0].qtyUnits, -60);
  assert.deepEqual(await auditStockInvariants(), []);
});

test("a partially reserved order ships only what it holds", async () => {
  const p = await makeProduct({ onHand: 30 });
  const c = await makeCustomer();
  const o = await makeOrder(c, [{ productId: p, qty: 100 }]);
  await accept(o);

  const shipped = await db.transaction((tx) =>
    consumeReservationsOnShip(tx, o, "2026-08-01", null),
  );
  assert.deepEqual(shipped, [{ productId: p, qty: 30 }]);
  assert.equal((await getStock(p)).onHand, 0);
});

// ---------------------------------------------------------------------------
// §7.3 shortfall list, and cache reconciliation
// ---------------------------------------------------------------------------

test("the shortfall list aggregates unfilled demand across accepted orders", async () => {
  const p = await makeProduct({ onHand: 10 });
  const c = await makeCustomer();
  const o1 = await makeOrder(c, [{ productId: p, qty: 50 }]);
  const o2 = await makeOrder(c, [{ productId: p, qty: 30 }]);
  await accept(o1);
  await accept(o2);

  const rows = await getShortfalls();
  const entry = rows.find((r) => r.productId === p);
  assert.ok(entry, "the product appears on the to-produce list");
  // o1 reserved 10 of 50 (short 40); o2 reserved 0 of 30 (short 30).
  assert.equal(entry.shortTotal, 70);
  assert.equal(entry.orders.length, 2);
});

test("recomputeStock rebuilds the cache from the ledger", async () => {
  const p = await makeProduct({ onHand: 100 });
  const c = await makeCustomer();
  const o = await makeOrder(c, [{ productId: p, qty: 40 }]);
  await accept(o);

  // Corrupt the cache the way a bug or a manual edit would.
  await db
    .update(productStock)
    .set({ onHand: 7, reserved: 999 })
    .where(eq(productStock.productId, p));
  assert.notDeepEqual(await auditStockInvariants(), []);

  await recomputeStock();

  const stock = await getStock(p);
  assert.equal(stock.onHand, 100);
  assert.equal(stock.reserved, 40);
  assert.deepEqual(await auditStockInvariants(), []);
});
