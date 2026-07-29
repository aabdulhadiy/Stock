import test from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, closeDb } from "@/db";
import {
  auditLog,
  customers,
  expenseCategories,
  expenses,
  orderItems,
  orders,
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
import { applyMovement, ensureStockRow } from "@/lib/stock";
import { createReturn } from "@/lib/returns";
import {
  abcXyzMatrix,
  coefficientOfVariation,
  getAbcXyz,
  getExpenseTotals,
  getFrozenStock,
  getProfitAndLoss,
  getSalesBreakdown,
  getSalesTotals,
  getStockValueDynamics,
} from "@/lib/analytics";
import { breakEvenRevenueCents, marginRatio } from "@/lib/money";
import type { Period } from "@/lib/dates";

/**
 * Phase 4 acceptance (§17): "operating profit on the dashboard equals a manual
 * cross-check for one month of real data; break-even matches the manual
 * formula".
 *
 * The month below IS the manual cross-check — every figure is stated in the
 * comments as arithmetic a Director could do on paper, then asserted against
 * what the system computes.
 */

const PREFIX = `ATEST-${process.pid}-`;
let seq = 0;
const nextSku = () => `${PREFIX}${++seq}`;

let actorId: string;
const createdProducts: string[] = [];
const createdCustomers: string[] = [];
const createdCategories: string[] = [];

/** The month under test. */
const MONTH: Period = { preset: "custom", from: "2026-03-01", to: "2026-03-31" };

async function makeActor(): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      login: `atest-${process.pid}`,
      passwordHash: "x",
      name: "Analytics director",
      role: "DIRECTOR",
    })
    .returning({ id: users.id });
  return row.id;
}

async function makeProduct(opts: {
  onHand: number;
  cost: number;
  market: number;
  receiptDate?: string;
}): Promise<string> {
  const [row] = await db
    .insert(products)
    .values({
      sku: nextSku(),
      name: `Analytics toy ${seq}`,
      unitsPerBox: 10,
      boxVolumeM3: "0.020000",
      weightKg: "2.000",
      weightBasis: "BOX",
      dimLengthCm: "20.0",
      dimWidthCm: "20.0",
      dimHeightCm: "20.0",
      costPriceCents: opts.cost,
      marketPriceCents: opts.market,
      exportPriceCents: opts.market,
    })
    .returning({ id: products.id });
  createdProducts.push(row.id);
  await ensureStockRow(db, row.id);
  await db.transaction(async (tx) => {
    await applyMovement(tx, {
      productId: row.id,
      type: "RECEIPT",
      qtyUnits: opts.onHand,
      movementDate: opts.receiptDate ?? "2026-02-01",
    });
  });
  return row.id;
}

async function makeCustomer(channel: "DOMESTIC" | "EXPORT" = "DOMESTIC"): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({
      name: `Analytics customer ${nextSku()}`,
      phone: nextSku(),
      channel,
      defaultPriceType: channel === "EXPORT" ? "EXPORT" : "MARKET",
    })
    .returning({ id: customers.id });
  createdCustomers.push(row.id);
  return row.id;
}

async function ship(opts: {
  customerId: string;
  productId: string;
  qty: number;
  unitPriceCents: number;
  shipDate: string;
}): Promise<{ orderId: string; lineId: string }> {
  const { orderId } = await createOrder(
    actorId,
    {
      customerId: opts.customerId,
      priceType: "MARKET",
      plannedShipDate: opts.shipDate,
      paymentMethod: "BANK",
      paymentTermDays: 30,
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
  await shipOrder(actorId, orderId, opts.shipDate);
  return { orderId, lineId: line.id };
}

async function makeExpenseCategory(
  name: string,
  type: "FIXED" | "VARIABLE",
): Promise<string> {
  const [row] = await db
    .insert(expenseCategories)
    .values({ name: `${PREFIX}${name}`, type })
    .returning({ id: expenseCategories.id });
  createdCategories.push(row.id);
  return row.id;
}

async function addExpense(categoryId: string, cents: number, date: string): Promise<void> {
  await db.insert(expenses).values({
    expenseDate: date,
    categoryId,
    amountCents: cents,
    method: "BANK",
    userId: actorId,
  });
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
      await db
        .delete(returnItems)
        .where(inArray(returnItems.returnId, docs.map((d) => d.id)));
      await db.delete(returns).where(inArray(returns.orderId, orderIds));
    }
    await db.delete(auditLog).where(inArray(auditLog.entityId, orderIds));
    await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
    await db.delete(stockMovements).where(inArray(stockMovements.orderId, orderIds));
    await db.delete(orders).where(inArray(orders.id, orderIds));
  }
  if (createdCategories.length) {
    await db.delete(expenses).where(inArray(expenses.categoryId, createdCategories));
    await db
      .delete(expenseCategories)
      .where(inArray(expenseCategories.id, createdCategories));
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
// The manual cross-check
// ---------------------------------------------------------------------------

test("§17: operating profit and break-even match a hand calculation", async () => {
  const domestic = await makeCustomer("DOMESTIC");
  const exporter = await makeCustomer("EXPORT");

  // Product A: cost $2.00, sold at $5.00.
  const a = await makeProduct({ onHand: 1000, cost: 200, market: 500 });
  // Product B: cost $10.00, sold at $25.00.
  const b = await makeProduct({ onHand: 1000, cost: 1000, market: 2500 });

  // --- March shipments -----------------------------------------------------
  // 100 × A at $5.00  = $500.00 revenue, $200.00 cost
  await ship({ customerId: domestic, productId: a, qty: 100, unitPriceCents: 500, shipDate: "2026-03-05" });
  //  40 × B at $25.00 = $1000.00 revenue, $400.00 cost
  await ship({ customerId: exporter, productId: b, qty: 40, unitPriceCents: 2500, shipDate: "2026-03-12" });
  //  20 × A at $4.50 (discount) = $90.00 revenue, $40.00 cost
  const discounted = await ship({
    customerId: domestic,
    productId: a,
    qty: 20,
    unitPriceCents: 450,
    shipDate: "2026-03-20",
  });

  // A February shipment that must NOT count toward March.
  await ship({ customerId: domestic, productId: a, qty: 500, unitPriceCents: 500, shipDate: "2026-02-10" });

  // --- A March return ------------------------------------------------------
  // 5 of the discounted A units come back: −$22.50 revenue, −$10.00 cost.
  await createReturn(actorId, {
    orderId: discounted.orderId,
    returnDate: "2026-03-25",
    note: "damaged",
    lines: [{ orderItemId: discounted.lineId, qtyUnits: 5 }],
  });

  // --- March expenses ------------------------------------------------------
  const rent = await makeExpenseCategory("Rent", "FIXED");
  const salaries = await makeExpenseCategory("Salaries", "FIXED");
  const transport = await makeExpenseCategory("Transport", "VARIABLE");

  await addExpense(rent, 30_000, "2026-03-01"); // $300.00 fixed
  await addExpense(salaries, 50_000, "2026-03-01"); // $500.00 fixed
  await addExpense(transport, 12_500, "2026-03-18"); // $125.00 variable
  // A February expense that must not count toward March.
  await addExpense(rent, 30_000, "2026-02-01");

  // ------------------------------------------------------------------------
  // Manual arithmetic, as a Director would do it on paper:
  //
  //   Revenue  = 500.00 + 1000.00 + 90.00 − 22.50 = 1567.50  ->  156_750 cents
  //   COGS     = 200.00 +  400.00 + 40.00 − 10.00 =  630.00  ->   63_000 cents
  //   Gross    = 1567.50 − 630.00              =  937.50  ->   93_750 cents
  //   Expenses = 300.00 + 500.00 + 125.00      =  925.00  ->   92_500 cents
  //   Operating profit = 937.50 − 925.00       =   12.50  ->    1_250 cents
  //   Gross margin     = 937.50 / 1567.50      = 0.598086...
  //   Break-even       = fixed 800.00 / 0.598086 = 1337.4...  -> 133_747 cents
  // ------------------------------------------------------------------------

  const pnl = await getProfitAndLoss(MONTH);

  assert.equal(pnl.revenueCents, 156_750, "revenue");
  assert.equal(pnl.cogsCents, 63_000, "COGS");
  assert.equal(pnl.grossProfitCents, 93_750, "gross profit");
  assert.equal(pnl.operatingExpensesCents, 92_500, "operating expenses");
  assert.equal(pnl.fixedExpensesCents, 80_000, "fixed expenses");
  assert.equal(pnl.variableExpensesCents, 12_500, "variable expenses");
  assert.equal(pnl.operatingProfitCents, 1_250, "operating profit");

  // Margin and break-even, against the formula rather than a copied constant.
  const expectedMargin = 93_750 / 156_750;
  assert.ok(
    Math.abs((pnl.grossMargin ?? 0) - expectedMargin) < 1e-12,
    `gross margin ${pnl.grossMargin} vs ${expectedMargin}`,
  );
  assert.equal(
    pnl.breakEvenRevenueCents,
    Math.round(80_000 / expectedMargin),
    "break-even = fixed expenses / gross margin (§9.4)",
  );
  // Revenue is above break-even this month, so progress exceeds 1.
  assert.ok((pnl.breakEvenProgress ?? 0) > 1);

  // Expenses as a share of revenue (§9.4).
  assert.ok(
    Math.abs((pnl.expenseRatio ?? 0) - 92_500 / 156_750) < 1e-12,
    "expense ratio",
  );
});

test("February is untouched by March's figures", async () => {
  const feb = await getProfitAndLoss({
    preset: "custom",
    from: "2026-02-01",
    to: "2026-02-28",
  });
  // The February shipment was 500 × A at $5.00 = $2500.00, cost $1000.00,
  // and one $300.00 rent expense.
  assert.equal(feb.revenueCents, 250_000);
  assert.equal(feb.cogsCents, 100_000);
  assert.equal(feb.grossProfitCents, 150_000);
  assert.equal(feb.operatingExpensesCents, 30_000);
  assert.equal(feb.operatingProfitCents, 120_000);
});

test("the sales breakdown by channel sums to the period total", async () => {
  const [byChannel, totals] = await Promise.all([
    getSalesBreakdown(MONTH, "channel"),
    getSalesTotals(MONTH),
  ]);

  const summed = byChannel.reduce((s, r) => s + r.revenueCents, 0);
  assert.equal(summed, totals.revenueCents, "channel split reconciles to the total");

  const exportRow = byChannel.find((r) => r.key === "EXPORT");
  assert.ok(exportRow, "the export channel appears");
  assert.equal(exportRow.revenueCents, 100_000, "40 x $25.00");

  const domesticRow = byChannel.find((r) => r.key === "DOMESTIC");
  // 500.00 + 90.00 − 22.50 returned = 567.50
  assert.equal(domesticRow!.revenueCents, 56_750);
});

test("the sales breakdown by product nets returns off the right product", async () => {
  const byProduct = await getSalesBreakdown(MONTH, "product");
  const summed = byProduct.reduce((s, r) => s + r.revenueCents, 0);
  const totals = await getSalesTotals(MONTH);
  assert.equal(summed, totals.revenueCents);

  // Product A: 100 × 5.00 + 20 × 4.50 − 5 × 4.50 = 567.50
  const productA = byProduct.find((r) => r.revenueCents === 56_750);
  assert.ok(productA, "product A nets its own return, not another product's");
});

test("expense totals split fixed from variable", async () => {
  const totals = await getExpenseTotals(MONTH);
  assert.equal(totals.totalCents, 92_500);
  assert.equal(totals.fixedCents, 80_000);
  assert.equal(totals.variableCents, 12_500);
  assert.equal(
    totals.byCategory.reduce((s, c) => s + c.amountCents, 0),
    totals.totalCents,
    "the category split reconciles",
  );
});

// ---------------------------------------------------------------------------
// Break-even edge cases
// ---------------------------------------------------------------------------

test("break-even is undefined at a non-positive margin, not a fabricated number", () => {
  assert.equal(breakEvenRevenueCents(80_000, 0.5), 160_000);
  assert.equal(breakEvenRevenueCents(80_000, 0), null, "a zero margin never breaks even");
  assert.equal(breakEvenRevenueCents(80_000, -0.2), null, "nor a negative one");
  assert.equal(breakEvenRevenueCents(80_000, null), null, "nor an unknown one");
  assert.equal(breakEvenRevenueCents(0, 0.5), 0, "no fixed costs means no hurdle");
});

test("margin is null rather than zero when there is no revenue", () => {
  assert.equal(marginRatio(0, 0), null);
  assert.equal(marginRatio(100, 25), 0.25);
});

test("a month with expenses but no sales reports a loss and no break-even", async () => {
  const empty = await getProfitAndLoss({
    preset: "custom",
    from: "2026-01-01",
    to: "2026-01-31",
  });
  assert.equal(empty.revenueCents, 0);
  assert.equal(empty.grossMargin, null);
  assert.equal(empty.breakEvenRevenueCents, null);
  assert.equal(empty.breakEvenProgress, null);
});

// ---------------------------------------------------------------------------
// ABC / XYZ (§4.4)
// ---------------------------------------------------------------------------

test("the coefficient of variation matches the statistical definition", () => {
  // A perfectly flat series has zero variation.
  assert.equal(coefficientOfVariation([10, 10, 10, 10]), 0);
  // 0 and 20 around a mean of 10: population sd is 10, so CV = 1.
  assert.equal(coefficientOfVariation([0, 20]), 1);
  // Too short to speak of, or no mean to divide by.
  assert.equal(coefficientOfVariation([5]), null);
  assert.equal(coefficientOfVariation([0, 0, 0]), null);
});

test("ABC classes follow cumulative revenue share, XYZ follows demand stability", async () => {
  const customer = await makeCustomer();
  // A steady seller: the same 30 units every month for three months.
  const steady = await makeProduct({ onHand: 1000, cost: 100, market: 1000 });
  // A spiky one: everything in a single month.
  const spiky = await makeProduct({ onHand: 1000, cost: 100, market: 100 });

  for (const month of ["2026-05", "2026-06", "2026-07"]) {
    await ship({
      customerId: customer,
      productId: steady,
      qty: 30,
      unitPriceCents: 1000,
      shipDate: `${month}-10`,
    });
  }
  await ship({
    customerId: customer,
    productId: spiky,
    qty: 60,
    unitPriceCents: 100,
    shipDate: "2026-06-10",
  });

  const { rows } = await getAbcXyz({
    preset: "custom",
    from: "2026-05-01",
    to: "2026-07-31",
  });

  const steadyRow = rows.find((r) => r.productId === steady);
  const spikyRow = rows.find((r) => r.productId === spiky);
  assert.ok(steadyRow && spikyRow);

  // $900 of steady revenue vs $60 spiky: the steady one is the A product.
  assert.equal(steadyRow.abc, "A", "the dominant seller must be class A");
  assert.equal(steadyRow.xyz, "X", "identical monthly demand is perfectly stable");
  assert.equal(steadyRow.variation, 0);

  assert.notEqual(spikyRow.abc, "A", "a 6% tail product is not class A");
  assert.equal(spikyRow.xyz, "Z", "one spike across three months is erratic");

  // The property that matters: the top seller by revenue is always class A.
  assert.equal(rows[0].abc, "A");

  // Cumulative share is monotonic and ends at 100%.
  let previous = 0;
  for (const row of rows) {
    assert.ok(row.cumulativeShare >= previous - 1e-9, "cumulative share never decreases");
    previous = row.cumulativeShare;
  }
  assert.ok(Math.abs(previous - 1) < 1e-9, "cumulative share reaches 100%");

  // Every product lands in exactly one matrix cell.
  const matrix = abcXyzMatrix(rows);
  const placed = Object.values(matrix).reduce((s, cell) => s + cell.length, 0);
  assert.equal(placed, rows.length);
});

// ---------------------------------------------------------------------------
// Frozen stock and stock value
// ---------------------------------------------------------------------------

test("frozen stock lists non-moving products with their tied-up capital", async () => {
  // Received long ago, never sold: unambiguously frozen.
  const stale = await makeProduct({
    onHand: 40,
    cost: 250,
    market: 900,
    receiptDate: "2025-01-15",
  });

  const { rows, totalValueCents } = await getFrozenStock();
  const row = rows.find((r) => r.productId === stale);
  assert.ok(row, "the stale product is frozen");
  assert.equal(row.movement, "FROZEN");
  assert.equal(row.valueAtCostCents, 40 * 250, "40 units at $2.50");
  assert.ok(row.daysIdle !== null && row.daysIdle > 90);
  assert.ok(totalValueCents >= row.valueAtCostCents);
});

test("stock value dynamics reports one closing figure per month", async () => {
  const rows = await getStockValueDynamics({
    preset: "custom",
    from: "2026-01-01",
    to: "2026-04-30",
  });
  assert.deepEqual(
    rows.map((r) => r.month),
    ["2026-01", "2026-02", "2026-03", "2026-04"],
  );
  // Closing figures are cumulative over the ledger, so units never go negative.
  for (const row of rows) {
    assert.ok(row.closingUnits >= 0, `${row.month} closed at ${row.closingUnits}`);
  }
});
