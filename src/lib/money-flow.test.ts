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
  returnItems,
  returns,
  stockMovements,
  users,
} from "@/db/schema";
import {
  acceptOrder,
  createOrder,
  markOrderReady,
  setLinePicked,
  shipOrder,
} from "@/lib/orders";
import { applyMovement, ensureStockRow, getStock } from "@/lib/stock";
import { PaymentError, getOrderBalance, recordPayment } from "@/lib/payments";
import { ReturnError, createReturn, getReturnableLines } from "@/lib/returns";
import { getCustomer } from "@/lib/queries/customers";
import { getReceivables } from "@/lib/queries/receivables";
import { agingBucket, gradeFromDelay } from "@/lib/dates";

/**
 * Phase 3 acceptance (§17): partial payment math, overdue detection on day +1,
 * and a return restoring stock while correcting both debt and profit.
 */

const PREFIX = `MTEST-${process.pid}-`;
let seq = 0;
const nextSku = () => `${PREFIX}${++seq}`;

let actorId: string;
const createdProducts: string[] = [];
const createdCustomers: string[] = [];

async function makeActor(): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      login: `mtest-${process.pid}`,
      passwordHash: "x",
      name: "Money test director",
      role: "DIRECTOR",
    })
    .returning({ id: users.id });
  return row.id;
}

async function makeProduct(onHand: number, cost = 400, market = 1000): Promise<string> {
  const [row] = await db
    .insert(products)
    .values({
      sku: nextSku(),
      name: "Money test toy",
      unitsPerBox: 10,
      boxVolumeM3: "0.030000",
      weightKg: "3.000",
      weightBasis: "BOX",
      dimLengthCm: "30.0",
      dimWidthCm: "20.0",
      dimHeightCm: "15.0",
      costPriceCents: cost,
      marketPriceCents: market,
      exportPriceCents: market + 200,
    })
    .returning({ id: products.id });
  createdProducts.push(row.id);
  await ensureStockRow(db, row.id);
  await db.transaction(async (tx) => {
    await applyMovement(tx, {
      productId: row.id,
      type: "RECEIPT",
      qtyUnits: onHand,
      movementDate: "2026-01-01",
    });
  });
  return row.id;
}

async function makeCustomer(): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({
      name: `Money customer ${nextSku()}`,
      phone: nextSku(),
      channel: "DOMESTIC",
      defaultPriceType: "MARKET",
    })
    .returning({ id: customers.id });
  createdCustomers.push(row.id);
  return row.id;
}

/** Create, accept, pick, ready and ship an order in one go. */
async function shipNewOrder(opts: {
  customerId: string;
  productId: string;
  qty: number;
  unitPriceCents: number;
  termDays?: number;
  shipDate?: string;
}): Promise<{ orderId: string; number: string; lineId: string }> {
  const { orderId, number } = await createOrder(
    actorId,
    {
      customerId: opts.customerId,
      priceType: "MARKET",
      plannedShipDate: opts.shipDate ?? "2026-06-01",
      paymentMethod: "BANK",
      paymentTermDays: opts.termDays ?? 30,
      note: null,
    },
    [
      {
        productId: opts.productId,
        qty: opts.qty,
        enteredAs: "UNITS",
        unitPriceCents: opts.unitPriceCents,
      },
    ],
  );

  await acceptOrder(actorId, orderId);
  const [line] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  await setLinePicked(actorId, line.id, true);
  await markOrderReady(actorId, orderId);
  await shipOrder(actorId, orderId, opts.shipDate ?? "2026-06-01");

  return { orderId, number, lineId: line.id };
}

test.before(async () => {
  actorId = await makeActor();
});

test.after(async () => {
  const ownedOrders = createdCustomers.length
    ? await db
        .select({ id: orders.id })
        .from(orders)
        .where(inArray(orders.customerId, createdCustomers))
    : [];
  const orderIds = ownedOrders.map((o) => o.id);

  if (orderIds.length) {
    const docs = await db
      .select({ id: returns.id })
      .from(returns)
      .where(inArray(returns.orderId, orderIds));
    if (docs.length) {
      await db.delete(returnItems).where(
        inArray(returnItems.returnId, docs.map((d) => d.id)),
      );
      await db.delete(returns).where(inArray(returns.orderId, orderIds));
    }
    await db.delete(payments).where(inArray(payments.orderId, orderIds));
    await db.delete(auditLog).where(inArray(auditLog.entityId, orderIds));
    await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
    await db.delete(stockMovements).where(inArray(stockMovements.orderId, orderIds));
    await db.delete(orders).where(inArray(orders.id, orderIds));
  }
  if (createdProducts.length) {
    await db.delete(stockMovements).where(inArray(stockMovements.productId, createdProducts));
    await db.delete(productStock).where(inArray(productStock.productId, createdProducts));
    await db.delete(products).where(inArray(products.id, createdProducts));
  }
  if (createdCustomers.length) {
    await db.delete(customers).where(inArray(customers.id, createdCustomers));
  }
  if (actorId) {
    await db.delete(auditLog).where(eq(auditLog.userId, actorId));
    await db.delete(users).where(eq(users.id, actorId));
  }
  await closeDb();
});

// ---------------------------------------------------------------------------
// Partial payments
// ---------------------------------------------------------------------------

test("partial payments accumulate and the balance is exact", async () => {
  const c = await makeCustomer();
  const p = await makeProduct(100);
  // 30 units at $10.00 = $300.00
  const { orderId } = await shipNewOrder({
    customerId: c,
    productId: p,
    qty: 30,
    unitPriceCents: 1000,
  });

  let balance = await getOrderBalance(orderId);
  assert.equal(balance!.totalCents, 30_000);
  assert.equal(balance!.balanceCents, 30_000);
  assert.equal(balance!.fullyPaid, false);

  await recordPayment(actorId, {
    orderId,
    paidOn: "2026-06-10",
    amountCents: 12_345,
    method: "CASH",
    note: null,
  });
  balance = await getOrderBalance(orderId);
  assert.equal(balance!.paidCents, 12_345);
  assert.equal(balance!.balanceCents, 17_655, "no rounding drift on odd cents");

  await recordPayment(actorId, {
    orderId,
    paidOn: "2026-06-20",
    amountCents: 17_655,
    method: "BANK",
    note: null,
  });
  balance = await getOrderBalance(orderId);
  assert.equal(balance!.balanceCents, 0);
  assert.equal(balance!.fullyPaid, true);
});

test("a payment above the outstanding balance is refused", async () => {
  const c = await makeCustomer();
  const p = await makeProduct(50);
  const { orderId } = await shipNewOrder({
    customerId: c,
    productId: p,
    qty: 10,
    unitPriceCents: 1000,
  });

  await assert.rejects(
    () =>
      recordPayment(actorId, {
        orderId,
        paidOn: "2026-06-10",
        amountCents: 10_001,
        method: "CASH",
        note: null,
      }),
    (err: unknown) => err instanceof PaymentError && err.reason === "EXCEEDS_BALANCE",
  );

  const balance = await getOrderBalance(orderId);
  assert.equal(balance!.paidCents, 0, "nothing was recorded");
});

test("a payment cannot be recorded against an unshipped order", async () => {
  const c = await makeCustomer();
  const p = await makeProduct(50);
  const { orderId } = await createOrder(
    actorId,
    {
      customerId: c,
      priceType: "MARKET",
      plannedShipDate: "2026-06-01",
      paymentMethod: "CASH",
      paymentTermDays: 0,
      note: null,
    },
    [{ productId: p, qty: 5, enteredAs: "UNITS", unitPriceCents: 1000 }],
  );

  await assert.rejects(
    () =>
      recordPayment(actorId, {
        orderId,
        paidOn: "2026-06-01",
        amountCents: 100,
        method: "CASH",
        note: null,
      }),
    (err: unknown) => err instanceof PaymentError && err.reason === "NOT_SHIPPED",
  );
});

// ---------------------------------------------------------------------------
// Overdue detection on day +1
// ---------------------------------------------------------------------------

test("overdue detection starts the day after the due date", () => {
  // Due 30 June: on the 30th it is current, on 1 July it is overdue.
  assert.equal(agingBucket("2026-06-30", "2026-06-29"), "CURRENT");
  assert.equal(agingBucket("2026-06-30", "2026-06-30"), "CURRENT", "not overdue on the due date");
  assert.equal(agingBucket("2026-06-30", "2026-07-01"), "D1_7", "overdue on day +1");
  assert.equal(agingBucket("2026-06-30", "2026-07-07"), "D1_7");
  assert.equal(agingBucket("2026-06-30", "2026-07-08"), "D8_30");
  assert.equal(agingBucket("2026-06-30", "2026-07-30"), "D8_30");
  assert.equal(agingBucket("2026-06-30", "2026-07-31"), "D30_PLUS");
});

test("an unpaid shipped order appears in receivables with its aging bucket", async () => {
  const c = await makeCustomer();
  const p = await makeProduct(100);
  // Shipped 2026-01-05 on 30-day terms: due 2026-02-04, months overdue.
  const { orderId, number } = await shipNewOrder({
    customerId: c,
    productId: p,
    qty: 20,
    unitPriceCents: 1000,
    termDays: 30,
    shipDate: "2026-01-05",
  });

  const { rows } = await getReceivables({ customerId: c });
  const row = rows.find((r) => r.orderId === orderId);
  assert.ok(row, "the order is outstanding");
  assert.equal(row.number, number);
  assert.equal(row.dueDate, "2026-02-04");
  assert.equal(row.balanceCents, 20_000);
  assert.ok(row.overdueDays > 0, "it is overdue");
  assert.equal(row.bucket, "D30_PLUS");
});

test("a fully paid order leaves the receivables list", async () => {
  const c = await makeCustomer();
  const p = await makeProduct(100);
  const { orderId } = await shipNewOrder({
    customerId: c,
    productId: p,
    qty: 10,
    unitPriceCents: 1000,
  });

  await recordPayment(actorId, {
    orderId,
    paidOn: "2026-06-05",
    amountCents: 10_000,
    method: "BANK",
    note: null,
  });

  const { rows } = await getReceivables({ customerId: c });
  assert.equal(rows.find((r) => r.orderId === orderId), undefined);
});

// ---------------------------------------------------------------------------
// Customer grade (§8.2)
// ---------------------------------------------------------------------------

test("the customer grade follows the average payment delay", () => {
  assert.equal(gradeFromDelay(0), "A");
  assert.equal(gradeFromDelay(-3), "A", "paying early is still grade A");
  assert.equal(gradeFromDelay(1), "B");
  assert.equal(gradeFromDelay(7), "B");
  assert.equal(gradeFromDelay(8), "C");
  assert.equal(gradeFromDelay(30), "C");
  assert.equal(gradeFromDelay(31), "D");
  assert.equal(gradeFromDelay(null), null, "no history means no grade");
});

test("paying on time grades the customer A; leaving it unpaid degrades them", async () => {
  const onTime = await makeCustomer();
  const p = await makeProduct(200);

  const { orderId } = await shipNewOrder({
    customerId: onTime,
    productId: p,
    qty: 10,
    unitPriceCents: 1000,
    termDays: 30,
    shipDate: "2026-06-01",
  });
  // Due 2026-07-01, paid 2026-06-20 — early.
  await recordPayment(actorId, {
    orderId,
    paidOn: "2026-06-20",
    amountCents: 10_000,
    method: "BANK",
    note: null,
  });

  const good = await getCustomer(onTime);
  assert.equal(good!.grade, "A");
  assert.equal(good!.latePaymentCount, 0);
  assert.equal(good!.debtCents, 0);

  // A second customer who never paid a long-overdue order.
  const late = await makeCustomer();
  await shipNewOrder({
    customerId: late,
    productId: p,
    qty: 10,
    unitPriceCents: 1000,
    termDays: 7,
    shipDate: "2026-01-05",
  });

  const bad = await getCustomer(late);
  assert.equal(bad!.grade, "D", "months overdue and unpaid");
  assert.equal(bad!.latePaymentCount, 1);
  assert.equal(bad!.debtCents, 10_000);
});

// ---------------------------------------------------------------------------
// Returns (§11)
// ---------------------------------------------------------------------------

test("a return restores stock, credits the debt and reverses profit", async () => {
  const c = await makeCustomer();
  // Cost $4.00, sold at $10.00.
  const p = await makeProduct(100, 400, 1000);

  const { orderId, lineId } = await shipNewOrder({
    customerId: c,
    productId: p,
    qty: 30,
    unitPriceCents: 1000,
  });

  const afterShip = await getStock(p);
  assert.equal(afterShip.onHand, 70);

  // Customer pays half, then returns 10 units.
  await recordPayment(actorId, {
    orderId,
    paidOn: "2026-06-10",
    amountCents: 15_000,
    method: "BANK",
    note: null,
  });

  await createReturn(actorId, {
    orderId,
    returnDate: "2026-06-15",
    note: "damaged",
    lines: [{ orderItemId: lineId, qtyUnits: 10 }],
  });

  // 1. Stock came back.
  const afterReturn = await getStock(p);
  assert.equal(afterReturn.onHand, 80, "10 units returned to the warehouse");
  const movements = await db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.productId, p));
  const returnMovement = movements.find((m) => m.type === "RETURN");
  assert.ok(returnMovement, "a RETURN movement is written");
  assert.equal(returnMovement.qtyUnits, 10);

  // 2. Debt corrected: $300 total − $150 paid − $100 returned = $50.
  const balance = await getOrderBalance(orderId);
  assert.equal(balance!.returnedCents, 10_000);
  assert.equal(balance!.balanceCents, 5_000);

  const customer = await getCustomer(c);
  assert.equal(customer!.debtCents, 5_000, "the customer's debt reflects the return");

  // 3. The return line carries the price and cost snapshots needed to reverse
  //    revenue and COGS.
  const [item] = await db
    .select()
    .from(returnItems)
    .where(eq(returnItems.orderItemId, lineId));
  assert.equal(item.unitPriceCents, 1000, "reverses at the price actually sold");
  assert.equal(item.costSnapshotCents, 400, "reverses COGS at the shipped cost");
});

test("a return cannot exceed what was shipped, across several returns", async () => {
  const c = await makeCustomer();
  const p = await makeProduct(100);
  const { orderId, lineId } = await shipNewOrder({
    customerId: c,
    productId: p,
    qty: 20,
    unitPriceCents: 1000,
  });

  await createReturn(actorId, {
    orderId,
    returnDate: "2026-06-05",
    note: null,
    lines: [{ orderItemId: lineId, qtyUnits: 15 }],
  });

  const returnable = await getReturnableLines(orderId);
  assert.equal(returnable[0].alreadyReturnedUnits, 15);
  assert.equal(returnable[0].remainingUnits, 5);

  // A second return of 6 would take the total to 21 of 20 shipped.
  await assert.rejects(
    () =>
      createReturn(actorId, {
        orderId,
        returnDate: "2026-06-06",
        note: null,
        lines: [{ orderItemId: lineId, qtyUnits: 6 }],
      }),
    (err: unknown) => err instanceof ReturnError && err.reason === "EXCEEDS_SHIPPED",
  );

  // The rejected return left nothing behind.
  const stock = await getStock(p);
  assert.equal(stock.onHand, 95, "80 shipped-out + 15 returned, not 21");
  const docs = await db.select().from(returns).where(eq(returns.orderId, orderId));
  assert.equal(docs.length, 1, "no partial second document was created");
});

test("a return against an unshipped order is refused", async () => {
  const c = await makeCustomer();
  const p = await makeProduct(50);
  const { orderId } = await createOrder(
    actorId,
    {
      customerId: c,
      priceType: "MARKET",
      plannedShipDate: "2026-06-01",
      paymentMethod: "CASH",
      paymentTermDays: 0,
      note: null,
    },
    [{ productId: p, qty: 5, enteredAs: "UNITS", unitPriceCents: 1000 }],
  );
  const [line] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  await assert.rejects(
    () =>
      createReturn(actorId, {
        orderId,
        returnDate: "2026-06-01",
        note: null,
        lines: [{ orderItemId: line.id, qtyUnits: 1 }],
      }),
    (err: unknown) => err instanceof ReturnError && err.reason === "NOT_SHIPPED",
  );
});

test("returning everything settles the order without a payment", async () => {
  const c = await makeCustomer();
  const p = await makeProduct(100);
  const { orderId, lineId } = await shipNewOrder({
    customerId: c,
    productId: p,
    qty: 10,
    unitPriceCents: 1000,
  });

  await createReturn(actorId, {
    orderId,
    returnDate: "2026-06-02",
    note: null,
    lines: [{ orderItemId: lineId, qtyUnits: 10 }],
  });

  const balance = await getOrderBalance(orderId);
  assert.equal(balance!.balanceCents, 0);
  assert.equal(balance!.fullyPaid, true);

  const { rows } = await getReceivables({ customerId: c });
  assert.equal(
    rows.find((r) => r.orderId === orderId),
    undefined,
    "a fully returned order is not a receivable",
  );
});
