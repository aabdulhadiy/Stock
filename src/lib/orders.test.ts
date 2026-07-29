import test from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, closeDb } from "@/db";
import {
  auditLog,
  customers,
  orderItems,
  orders,
  payments,
  productStock,
  products,
  stockMovements,
  users,
} from "@/db/schema";
import {
  acceptOrder,
  cancelOrder,
  createOrder,
  markOrderReady,
  OrderStateError,
  pickingSummary,
  reserveAvailableForOrder,
  setLinePicked,
  shipOrder,
  updateOrder,
} from "@/lib/orders";
import {
  applyMovement,
  auditStockInvariants,
  ensureStockRow,
  getStock,
} from "@/lib/stock";
import { formatOrderNumber, isValidOrderNumberFormat } from "@/lib/settings";
import { getOrderDetail } from "@/lib/queries/orders";

/**
 * Phase 2 acceptance scenarios, verbatim from §17:
 *
 *   (a) two orders for the same product — first accepted wins the stock,
 *       the second shows a shortfall
 *   (b) cancel an accepted order — Available restores instantly
 *   (c) cancel a New order — nothing changes
 *   (d) receipt arrives — alert fires and "Reserve available" tops up
 *   (e) two simultaneous acceptances cannot over-reserve (BR-9)
 *   (f) line-price override changes only that order
 *
 * Plus the §5.3 status machine and the §7.4 picking summary.
 */

const PREFIX = `OTEST-${process.pid}-`;
let seq = 0;
const nextSku = () => `${PREFIX}${++seq}`;
const TODAY = "2026-07-29";

let actorId: string;
const createdProducts: string[] = [];
const createdCustomers: string[] = [];

async function makeActor(): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      login: `otest-${process.pid}`,
      passwordHash: "x",
      name: "Test director",
      role: "DIRECTOR",
    })
    .returning({ id: users.id });
  return row.id;
}

async function makeProduct(opts: {
  onHand?: number;
  cost?: number;
  market?: number;
  export?: number;
  unitsPerBox?: number;
}): Promise<string> {
  const [row] = await db
    .insert(products)
    .values({
      sku: nextSku(),
      name: "Test toy",
      unitsPerBox: opts.unitsPerBox ?? 12,
      boxVolumeM3: "0.050000",
      weightKg: "6.000",
      weightBasis: "BOX",
      dimLengthCm: "40.0",
      dimWidthCm: "30.0",
      dimHeightCm: "25.0",
      costPriceCents: opts.cost ?? 450,
      marketPriceCents: opts.market ?? 790,
      exportPriceCents: opts.export ?? 950,
    })
    .returning({ id: products.id });

  createdProducts.push(row.id);
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

async function makeCustomer(channel: "DOMESTIC" | "EXPORT" = "DOMESTIC"): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({
      name: `Customer ${nextSku()}`,
      phone: nextSku(),
      channel,
      defaultPriceType: channel === "EXPORT" ? "EXPORT" : "MARKET",
    })
    .returning({ id: customers.id });
  createdCustomers.push(row.id);
  return row.id;
}

const header = (customerId: string, priceType: "MARKET" | "EXPORT" = "MARKET") => ({
  customerId,
  priceType,
  plannedShipDate: TODAY,
  paymentMethod: "CASH" as const,
  paymentTermDays: 0,
  note: null,
});

test.before(async () => {
  actorId = await makeActor();
});

test.after(async () => {
  // Scoped cleanup: only rows this suite created. Deleting whole tables would
  // wipe the seeded Director and race the other DB suites.
  const customerIds = createdCustomers;
  const productIds = createdProducts;

  const ownedOrders = customerIds.length
    ? await db
        .select({ id: orders.id })
        .from(orders)
        .where(inArray(orders.customerId, customerIds))
    : [];
  const orderIds = ownedOrders.map((o) => o.id);

  if (orderIds.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, orderIds));
    await db.delete(payments).where(inArray(payments.orderId, orderIds));
    await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
    await db.delete(stockMovements).where(inArray(stockMovements.orderId, orderIds));
    await db.delete(orders).where(inArray(orders.id, orderIds));
  }
  if (productIds.length) {
    await db.delete(stockMovements).where(inArray(stockMovements.productId, productIds));
    await db.delete(productStock).where(inArray(productStock.productId, productIds));
    await db.delete(products).where(inArray(products.id, productIds));
  }
  if (customerIds.length) {
    await db.delete(customers).where(inArray(customers.id, customerIds));
  }
  if (actorId) {
    await db.delete(auditLog).where(eq(auditLog.userId, actorId));
    await db.delete(users).where(eq(users.id, actorId));
  }
  await closeDb();
});

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

test("order numbers follow the configured format and increment", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100 });

  const first = await createOrder(actorId, header(c), [
    { productId: p, qty: 1, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);
  const second = await createOrder(actorId, header(c), [
    { productId: p, qty: 1, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  assert.match(first.number, /^ORD-\d{4}-\d{4}$/);
  assert.notEqual(first.number, second.number);
  const seqOf = (n: string) => Number(n.split("-")[2]);
  assert.equal(seqOf(second.number), seqOf(first.number) + 1);
});

test("the order number template renders and is validated", () => {
  assert.equal(formatOrderNumber("ORD-{YYYY}-{SEQ:4}", 2026, 7), "ORD-2026-0007");
  assert.equal(formatOrderNumber("{YY}/{SEQ}", 2026, 42), "26/42");
  assert.equal(isValidOrderNumberFormat("ORD-{YYYY}-{SEQ:4}"), true);
  assert.equal(isValidOrderNumberFormat("ORD-{YYYY}"), false, "no sequence = collisions");
});

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

test("boxes convert to units and the total uses the actual sold price", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 500, unitsPerBox: 12, market: 790 });

  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p, qty: 5, enteredAs: "BOXES", unitPriceCents: 700 },
  ]);

  const detail = await getOrderDetail(orderId, "DIRECTOR");
  assert.ok(detail);
  assert.equal(detail.lines[0].qtyOrderedUnits, 60, "5 boxes x 12 = 60 units");
  assert.equal(detail.lines[0].enteredQty, 5);
  assert.equal(detail.lines[0].enteredAs, "BOXES");
  assert.equal(detail.totalCents, 700 * 60, "total uses the discounted price");
  assert.equal(
    detail.lines[0].basePriceSnapshotCents,
    790,
    "the catalog price is snapshotted so the discount is measurable",
  );
});

test("an export-price order defaults its lines from the export price", async () => {
  const c = await makeCustomer("EXPORT");
  const p = await makeProduct({ onHand: 100, market: 790, export: 950 });

  const { orderId } = await createOrder(actorId, header(c, "EXPORT"), [
    { productId: p, qty: 10, enteredAs: "UNITS", unitPriceCents: 950 },
  ]);
  const detail = await getOrderDetail(orderId, "DIRECTOR");
  assert.equal(detail!.lines[0].basePriceSnapshotCents, 950);
});

test("BR-1: a new order reserves nothing", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100 });
  await createOrder(actorId, header(c), [
    { productId: p, qty: 60, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  const stock = await getStock(p);
  assert.equal(stock.reserved, 0);
  assert.equal(stock.available, 100);
});

test("an archived product cannot be added to a new order", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100 });
  await db.update(products).set({ status: "ARCHIVED" }).where(eq(products.id, p));

  await assert.rejects(
    () =>
      createOrder(actorId, header(c), [
        { productId: p, qty: 1, enteredAs: "UNITS", unitPriceCents: 790 },
      ]),
    /archived/i,
  );
});

// ---------------------------------------------------------------------------
// (a) first accepted wins
// ---------------------------------------------------------------------------

test("(a) two orders for the same product: first accepted wins, second is short", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100 });

  const first = await createOrder(actorId, header(c), [
    { productId: p, qty: 80, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);
  const second = await createOrder(actorId, header(c), [
    { productId: p, qty: 80, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  const a = await acceptOrder(actorId, first.orderId);
  const b = await acceptOrder(actorId, second.orderId);

  assert.equal(a[0].reserved, 80);
  assert.equal(a[0].shortfall, 0);
  assert.equal(b[0].reserved, 20);
  assert.equal(b[0].shortfall, 60);
  assert.equal((await getStock(p)).available, 0);
  assert.deepEqual(await auditStockInvariants(), []);
});

// ---------------------------------------------------------------------------
// (b) and (c) cancellation
// ---------------------------------------------------------------------------

test("(b) cancelling an accepted order restores Available immediately", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100 });
  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p, qty: 70, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  await acceptOrder(actorId, orderId);
  assert.equal((await getStock(p)).available, 30);

  const released = await cancelOrder(actorId, orderId);
  assert.equal(released, 70);
  assert.equal((await getStock(p)).available, 100);
});

test("(c) cancelling a NEW order changes nothing", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100 });
  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p, qty: 70, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  const released = await cancelOrder(actorId, orderId);
  assert.equal(released, 0);
  const stock = await getStock(p);
  assert.equal(stock.onHand, 100);
  assert.equal(stock.reserved, 0);
  assert.equal(stock.available, 100);
});

test("a shipped order can no longer be cancelled", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 50 });
  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p, qty: 10, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);
  await acceptOrder(actorId, orderId);
  const [line] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  await setLinePicked(actorId, line.id, true);
  await markOrderReady(actorId, orderId);
  await shipOrder(actorId, orderId, TODAY);

  await assert.rejects(() => cancelOrder(actorId, orderId), OrderStateError);
});

// ---------------------------------------------------------------------------
// (d) receipt then top-up
// ---------------------------------------------------------------------------

test("(d) after a receipt, 'Reserve available' tops up the shortfall", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 40 });
  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p, qty: 100, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  await acceptOrder(actorId, orderId);
  assert.equal((await getStock(p)).reserved, 40);

  await db.transaction(async (tx) => {
    await applyMovement(tx, {
      productId: p,
      type: "RECEIPT",
      qtyUnits: 45,
      movementDate: TODAY,
    });
  });

  // BR-5: nothing moves until someone presses the button.
  assert.equal((await getStock(p)).reserved, 40);

  const { gained, outcomes } = await reserveAvailableForOrder(actorId, orderId);
  assert.equal(gained, 45);
  assert.equal(outcomes[0].reserved, 85);
  assert.equal(outcomes[0].shortfall, 15);
});

test("topping up an order that needs nothing reports no gain", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100 });
  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p, qty: 10, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);
  await acceptOrder(actorId, orderId);

  const { gained } = await reserveAvailableForOrder(actorId, orderId);
  assert.equal(gained, 0);
});

// ---------------------------------------------------------------------------
// (e) BR-9 concurrency
// ---------------------------------------------------------------------------

test("(e) simultaneous acceptances cannot over-reserve", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100 });

  const ids = await Promise.all(
    Array.from({ length: 5 }, () =>
      createOrder(actorId, header(c), [
        { productId: p, qty: 40, enteredAs: "UNITS", unitPriceCents: 790 },
      ]),
    ),
  );

  const results = await Promise.all(ids.map((o) => acceptOrder(actorId, o.orderId)));
  const reserved = results.flat().reduce((s, o) => s + o.reserved, 0);

  assert.equal(reserved, 100, "only the physical 100 units get reserved");
  assert.equal((await getStock(p)).available, 0);
  assert.deepEqual(await auditStockInvariants(), []);
});

// ---------------------------------------------------------------------------
// (f) price override is per-order
// ---------------------------------------------------------------------------

test("(f) a line-price override changes only that order, not the catalog", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 200, market: 790 });

  const discounted = await createOrder(actorId, header(c), [
    { productId: p, qty: 10, enteredAs: "UNITS", unitPriceCents: 600 },
  ]);
  const normal = await createOrder(actorId, header(c), [
    { productId: p, qty: 10, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  const [product] = await db.select().from(products).where(eq(products.id, p));
  assert.equal(product.marketPriceCents, 790, "the catalog price is untouched");

  const a = await getOrderDetail(discounted.orderId, "DIRECTOR");
  const b = await getOrderDetail(normal.orderId, "DIRECTOR");
  assert.equal(a!.lines[0].unitPriceCents, 600);
  assert.equal(b!.lines[0].unitPriceCents, 790, "the other order keeps the full price");
  assert.equal(a!.totalCents, 6000);
  assert.equal(b!.totalCents, 7900);
});

test("a price change on an existing line is audited old -> new", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100, market: 790 });
  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p, qty: 10, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);
  const [line] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  await updateOrder(actorId, orderId, header(c), [
    { id: line.id, productId: p, qty: 10, enteredAs: "UNITS", unitPriceCents: 650 },
  ]);

  const entries = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, line.id));
  const priceChange = entries.find((e) => e.action === "price_change");
  assert.ok(priceChange, "a price_change entry is written (§12)");
  assert.deepEqual(priceChange.oldValue, { unitPriceCents: 790 });
  assert.deepEqual(priceChange.newValue, { unitPriceCents: 650 });
});

// ---------------------------------------------------------------------------
// §5.3 status machine
// ---------------------------------------------------------------------------

test("Ready requires every line fully reserved and picked", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 30 });
  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p, qty: 100, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);
  await acceptOrder(actorId, orderId);

  // Short: refused.
  await assert.rejects(
    () => markOrderReady(actorId, orderId),
    (err: unknown) =>
      err instanceof OrderStateError && err.reason === "NOT_FULLY_RESERVED",
  );

  // Bring stock in and top up, but leave the line unpicked.
  await db.transaction(async (tx) => {
    await applyMovement(tx, {
      productId: p,
      type: "RECEIPT",
      qtyUnits: 70,
      movementDate: TODAY,
    });
  });
  await reserveAvailableForOrder(actorId, orderId);

  await assert.rejects(
    () => markOrderReady(actorId, orderId),
    (err: unknown) => err instanceof OrderStateError && err.reason === "NOT_ALL_PICKED",
  );

  const [line] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  await setLinePicked(actorId, line.id, true);
  await markOrderReady(actorId, orderId);

  const [after] = await db.select().from(orders).where(eq(orders.id, orderId));
  assert.equal(after.status, "READY");
});

test("shipping freezes cost, sets the ship date and computes the due date", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100, cost: 450 });
  const { orderId } = await createOrder(
    actorId,
    { ...header(c), paymentTermDays: 30 },
    [{ productId: p, qty: 20, enteredAs: "UNITS", unitPriceCents: 790 }],
  );

  await acceptOrder(actorId, orderId);
  const [line] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  await setLinePicked(actorId, line.id, true);
  await markOrderReady(actorId, orderId);
  await shipOrder(actorId, orderId, "2026-08-01");

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  assert.equal(order.status, "SHIPPED");
  assert.equal(order.actualShipDate, "2026-08-01");
  assert.equal(order.dueDate, "2026-08-31", "ship date + 30 day term");

  const [shipped] = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.id, line.id));
  assert.equal(shipped.costSnapshotCents, 450);

  // A later cost edit must not rewrite history.
  await db.update(products).set({ costPriceCents: 999 }).where(eq(products.id, p));
  const [again] = await db.select().from(orderItems).where(eq(orderItems.id, line.id));
  assert.equal(again.costSnapshotCents, 450, "the snapshot is immune to cost edits");

  const stock = await getStock(p);
  assert.equal(stock.onHand, 80);
  assert.equal(stock.reserved, 0);
});

test("BR-8: reducing a line on an accepted order releases the difference", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100 });
  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p, qty: 80, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);
  await acceptOrder(actorId, orderId);
  const [line] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  await updateOrder(actorId, orderId, header(c), [
    { id: line.id, productId: p, qty: 30, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  const stock = await getStock(p);
  assert.equal(stock.reserved, 30);
  assert.equal(stock.available, 70);
  assert.deepEqual(await auditStockInvariants(), []);
});

test("removing a line from an accepted order releases its hold", async () => {
  const c = await makeCustomer();
  const p1 = await makeProduct({ onHand: 100 });
  const p2 = await makeProduct({ onHand: 100 });
  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p1, qty: 40, enteredAs: "UNITS", unitPriceCents: 790 },
    { productId: p2, qty: 40, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);
  await acceptOrder(actorId, orderId);

  const lines = await db
    .select({ id: orderItems.id, productId: orderItems.productId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const keep = lines.find((l) => l.productId === p1)!;

  await updateOrder(actorId, orderId, header(c), [
    { id: keep.id, productId: p1, qty: 40, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  assert.equal((await getStock(p1)).reserved, 40);
  assert.equal((await getStock(p2)).reserved, 0, "the dropped line released its stock");
  assert.deepEqual(await auditStockInvariants(), []);
});

test("a READY order drops back to PICKING when its lines stop adding up", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 50 });
  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p, qty: 20, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);
  await acceptOrder(actorId, orderId);
  const [line] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  await setLinePicked(actorId, line.id, true);
  await markOrderReady(actorId, orderId);

  // Increase beyond what is available: no longer fully reserved.
  await updateOrder(actorId, orderId, header(c), [
    { id: line.id, productId: p, qty: 200, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  const [after] = await db.select().from(orders).where(eq(orders.id, orderId));
  assert.equal(after.status, "PICKING");
});

// ---------------------------------------------------------------------------
// §7.1 availability colours and §7.4 summary
// ---------------------------------------------------------------------------

test("§7.1 availability is green / yellow / red as stock allows", async () => {
  const c = await makeCustomer();
  const full = await makeProduct({ onHand: 100 });
  const partial = await makeProduct({ onHand: 10 });
  const none = await makeProduct({ onHand: 0 });

  const { orderId } = await createOrder(actorId, header(c), [
    { productId: full, qty: 50, enteredAs: "UNITS", unitPriceCents: 790 },
    { productId: partial, qty: 50, enteredAs: "UNITS", unitPriceCents: 790 },
    { productId: none, qty: 50, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  const detail = await getOrderDetail(orderId, "WAREHOUSEMAN");
  const byProduct = new Map(detail!.lines.map((l) => [l.productId, l.availability]));
  assert.equal(byProduct.get(full), "FULL");
  assert.equal(byProduct.get(partial), "PARTIAL");
  assert.equal(byProduct.get(none), "NONE");
});

test("§7.4 picking summary respects the weight basis", () => {
  // 600 units in 50 boxes of 12; the weight is measured PER BOX.
  const perBox = pickingSummary([
    {
      productId: "a",
      qtyUnits: 600,
      unitsPerBox: 12,
      unitsPerBag: null,
      weightKg: 6,
      weightBasis: "BOX",
      boxVolumeM3: 0.05,
      bagVolumeM3: null,
      enteredAs: "BOXES",
    },
  ]);
  assert.equal(perBox.totalBoxes, 50);
  assert.equal(perBox.totalWeightKg, 300, "50 boxes x 6 kg, not 600 x 6");
  assert.equal(perBox.totalVolumeM3, 2.5);
  assert.equal(perBox.distinctProducts, 1);

  // The same figures with a PER UNIT basis weigh 600 x 6.
  const perUnit = pickingSummary([
    {
      productId: "a",
      qtyUnits: 600,
      unitsPerBox: 12,
      unitsPerBag: null,
      weightKg: 6,
      weightBasis: "UNIT",
      boxVolumeM3: 0.05,
      bagVolumeM3: null,
      enteredAs: "BOXES",
    },
  ]);
  assert.equal(perUnit.totalWeightKg, 3600);
});

test("§7.4 picking summary counts distinct products, not lines", () => {
  const summary = pickingSummary([
    {
      productId: "a",
      qtyUnits: 12,
      unitsPerBox: 12,
      unitsPerBag: null,
      weightKg: 1,
      weightBasis: "BOX",
      boxVolumeM3: 0.01,
      bagVolumeM3: null,
      enteredAs: "BOXES",
    },
    {
      productId: "a",
      qtyUnits: 12,
      unitsPerBox: 12,
      unitsPerBag: null,
      weightKg: 1,
      weightBasis: "BOX",
      boxVolumeM3: 0.01,
      bagVolumeM3: null,
      enteredAs: "BOXES",
    },
    {
      productId: "b",
      qtyUnits: 12,
      unitsPerBox: 12,
      unitsPerBag: null,
      weightKg: 1,
      weightBasis: "BOX",
      boxVolumeM3: 0.01,
      bagVolumeM3: null,
      enteredAs: "BOXES",
    },
  ]);
  assert.equal(summary.distinctProducts, 2);
  assert.equal(summary.totalUnits, 36);
});

// ---------------------------------------------------------------------------
// §2.2 — the warehouseman must not receive prices
// ---------------------------------------------------------------------------

test("a warehouseman's order payload carries no prices at all", async () => {
  const c = await makeCustomer();
  const p = await makeProduct({ onHand: 100 });
  const { orderId } = await createOrder(actorId, header(c), [
    { productId: p, qty: 10, enteredAs: "UNITS", unitPriceCents: 790 },
  ]);

  const warehouse = await getOrderDetail(orderId, "WAREHOUSEMAN");
  assert.ok(warehouse);
  assert.equal(warehouse.totalCents, undefined);
  assert.equal(warehouse.paidCents, undefined);
  assert.equal(warehouse.payments, undefined);
  for (const line of warehouse.lines) {
    assert.equal(line.unitPriceCents, undefined);
    assert.equal(line.basePriceSnapshotCents, undefined);
    assert.equal(line.lineTotalCents, undefined);
    assert.ok(!("unitPriceCents" in line), "the key is absent, not just undefined");
  }

  // The Director sees the same order with money.
  const director = await getOrderDetail(orderId, "DIRECTOR");
  assert.equal(director!.totalCents, 7900);
  assert.equal(director!.lines[0].unitPriceCents, 790);
});
