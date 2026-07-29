import test from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, closeDb } from "@/db";
import {
  auditLog,
  customers,
  orderItems,
  orders,
  productStock,
  products,
  stockMovements,
  users,
} from "@/db/schema";
import type { Role } from "@/db/schema";
import { findForbiddenKeys, toProductView, toStockView } from "@/lib/dto";
import { can, isPathAllowed, sectionRoles } from "@/lib/permissions";
import {
  acceptOrder,
  createOrder,
  markOrderReady,
  setLinePicked,
  shipOrder,
} from "@/lib/orders";
import { applyMovement, ensureStockRow } from "@/lib/stock";
import { listProductOptions, listProducts } from "@/lib/queries/products";
import { getOrderDetail, listOrders } from "@/lib/queries/orders";

/**
 * §2.2 is emphatic: "responses to non-Director clients must not contain
 * cost/price/profit/expense data at all", and the Phase 1 acceptance test is
 * "verify the warehouseman sees no prices anywhere INCLUDING raw API responses".
 *
 * So this suite does not inspect templates. It builds the real payloads the
 * server would send and walks them recursively for any key that looks like
 * money, using the same broad substring rule the DTO layer publishes — which
 * means a newly added `marginCents` field is caught without anyone remembering
 * to update a list.
 */

const PREFIX = `DTEST-${process.pid}-`;
let seq = 0;
const nextSku = () => `${PREFIX}${++seq}`;

let actorId: string;
const createdProducts: string[] = [];
const createdCustomers: string[] = [];

async function seedData(): Promise<{ productId: string; orderId: string }> {
  const [actor] = await db
    .insert(users)
    .values({
      login: `dtest-${process.pid}`,
      passwordHash: "x",
      name: "DTO director",
      role: "DIRECTOR",
    })
    .returning({ id: users.id });
  actorId = actor.id;

  const [product] = await db
    .insert(products)
    .values({
      sku: nextSku(),
      name: "Leak test toy",
      unitsPerBox: 12,
      boxVolumeM3: "0.040000",
      weightKg: "5.000",
      weightBasis: "BOX",
      dimLengthCm: "30.0",
      dimWidthCm: "25.0",
      dimHeightCm: "20.0",
      costPriceCents: 450,
      marketPriceCents: 900,
      exportPriceCents: 1100,
      minStock: 50,
    })
    .returning({ id: products.id });
  createdProducts.push(product.id);
  await ensureStockRow(db, product.id);
  await db.transaction(async (tx) => {
    await applyMovement(tx, {
      productId: product.id,
      type: "RECEIPT",
      qtyUnits: 200,
      movementDate: "2026-05-01",
    });
  });

  const [customer] = await db
    .insert(customers)
    .values({
      name: `Leak customer ${nextSku()}`,
      phone: nextSku(),
      channel: "DOMESTIC",
      defaultPriceType: "MARKET",
    })
    .returning({ id: customers.id });
  createdCustomers.push(customer.id);

  const { orderId } = await createOrder(
    actorId,
    {
      customerId: customer.id,
      priceType: "MARKET",
      plannedShipDate: "2026-05-10",
      paymentMethod: "CASH",
      paymentTermDays: 30,
      note: null,
    },
    [{ productId: product.id, qty: 30, enteredAs: "UNITS", unitPriceCents: 850 }],
  );

  // Walk it all the way to SHIPPED, so the payload carries cost snapshots too.
  await acceptOrder(actorId, orderId);
  const [line] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  await setLinePicked(actorId, line.id, true);
  await markOrderReady(actorId, orderId);
  await shipOrder(actorId, orderId, "2026-05-10");

  return { productId: product.id, orderId };
}

let fixture: { productId: string; orderId: string };

test.before(async () => {
  fixture = await seedData();
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
// The leak detector itself
// ---------------------------------------------------------------------------

test("the leak detector finds money keys at any depth", () => {
  const payload = {
    id: "x",
    nested: { deeper: [{ costPriceCents: 1 }] },
    safe: { onHand: 5 },
  };
  const hits = findForbiddenKeys(payload, "WAREHOUSEMAN");
  assert.deepEqual(hits, ["nested.deeper[0].costPriceCents"]);
  // A Director may see it, so nothing is reported.
  assert.deepEqual(findForbiddenKeys(payload, "DIRECTOR"), []);
});

test("the leak detector catches a field nobody remembered to list", () => {
  // The point of the substring rule: a brand-new money field is caught.
  const invented = { marginCents: 100, profitRatio: 0.4, expenseTotal: 9 };
  const hits = findForbiddenKeys(invented, "WAREHOUSEMAN");
  assert.deepEqual(hits.sort(), ["expenseTotal", "marginCents", "profitRatio"]);
});

test("the leak detector survives cycles and dates", () => {
  const cyclic: Record<string, unknown> = { at: new Date(), onHand: 1 };
  cyclic.self = cyclic;
  assert.deepEqual(findForbiddenKeys(cyclic, "WAREHOUSEMAN"), []);
});

// ---------------------------------------------------------------------------
// Product and stock projections
// ---------------------------------------------------------------------------

const PRODUCT_SOURCE = {
  id: "p1",
  sku: "SKU-1",
  name: "Toy",
  categoryId: null,
  categoryName: null,
  unitsPerBox: 12,
  unitsPerBag: null,
  boxVolumeM3: "0.04",
  bagVolumeM3: null,
  weightKg: "5",
  weightBasis: "BOX" as const,
  dimLengthCm: "30",
  dimWidthCm: "25",
  dimHeightCm: "20",
  dimsBasis: "BOX" as const,
  status: "ACTIVE" as const,
  minStock: 50,
  createdAt: new Date(),
  mainImageUrl: null,
  costPriceCents: 450,
  marketPriceCents: 900,
  exportPriceCents: 1100,
};

test("a warehouseman's product view has no price keys at all", () => {
  const view = toProductView(PRODUCT_SOURCE, "WAREHOUSEMAN");

  assert.ok(!("costPriceCents" in view), "the key is absent, not undefined");
  assert.ok(!("marketPriceCents" in view));
  assert.ok(!("exportPriceCents" in view));
  assert.deepEqual(findForbiddenKeys(view, "WAREHOUSEMAN"), []);

  // The identity and packing data they DO need is intact.
  assert.equal(view.sku, "SKU-1");
  assert.equal(view.unitsPerBox, 12);
  assert.equal(view.minStock, 50);

  // And it survives serialisation, which is what actually crosses the wire.
  const serialised = JSON.parse(JSON.stringify(view));
  assert.deepEqual(findForbiddenKeys(serialised, "WAREHOUSEMAN"), []);
});

test("a salesperson sees sale prices but never cost", () => {
  const view = toProductView(PRODUCT_SOURCE, "SALESPERSON");

  assert.equal(view.marketPriceCents, 900);
  assert.equal(view.exportPriceCents, 1100);
  assert.ok(!("costPriceCents" in view), "cost is Director-only (§2.2)");
  assert.deepEqual(findForbiddenKeys(view, "SALESPERSON"), []);
});

test("a Director sees everything", () => {
  const view = toProductView(PRODUCT_SOURCE, "DIRECTOR");
  assert.equal(view.costPriceCents, 450);
  assert.equal(view.marketPriceCents, 900);
  assert.equal(view.exportPriceCents, 1100);
});

test("stock values are stripped for everyone but the Director", () => {
  const source = {
    productId: "p1",
    sku: "SKU-1",
    name: "Toy",
    categoryName: null,
    mainImageUrl: null,
    unitsPerBox: 12,
    onHand: 200,
    reserved: 30,
    available: 170,
    minStock: 50,
    belowMinimum: false,
    daysInWarehouse: 5,
    lastSaleDate: null,
    daysSinceSale: null,
    movement: "NORMAL" as const,
    valueAtCostCents: 90_000,
    valueAtMarketCents: 180_000,
  };

  for (const role of ["WAREHOUSEMAN", "SALESPERSON"] as Role[]) {
    const view = toStockView(source, role);
    assert.ok(!("valueAtCostCents" in view), `${role} must not receive stock value`);
    assert.ok(!("valueAtMarketCents" in view));
    // Quantities are theirs to see (§2.2, §10.2).
    assert.equal(view.onHand, 200);
    assert.equal(view.reserved, 30);
    assert.equal(view.available, 170);
  }

  const director = toStockView(source, "DIRECTOR");
  assert.equal(director.valueAtCostCents, 90_000);
});

// ---------------------------------------------------------------------------
// Real query payloads, end to end
// ---------------------------------------------------------------------------

test("the product list payload is clean for a warehouseman", async () => {
  const { rows } = await listProducts("WAREHOUSEMAN", { status: "ALL", pageSize: 500 });
  assert.ok(rows.length > 0, "there is something to check");

  const hits = findForbiddenKeys(rows, "WAREHOUSEMAN");
  assert.deepEqual(hits, [], `leaked: ${hits.join(", ")}`);

  // Same payload, Director: the money is present, proving the fixture has it.
  const director = await listProducts("DIRECTOR", { status: "ALL", pageSize: 500 });
  const target = director.rows.find((r) => r.product.id === fixture.productId);
  assert.equal(target?.product.costPriceCents, 450);
  assert.ok((target?.stock.valueAtCostCents ?? 0) > 0);
});

test("the stock overview payload is clean for a salesperson (no values)", async () => {
  const { rows } = await listProducts("SALESPERSON", { status: "ALL", pageSize: 500 });
  const hits = findForbiddenKeys(rows.map((r) => r.stock), "DIRECTOR");
  // Sanity: the Director rule reports nothing, so the next assertion is about
  // the salesperson rule specifically, not about the shape being empty.
  assert.deepEqual(hits, []);

  for (const row of rows) {
    assert.ok(!("valueAtCostCents" in row.stock));
    assert.ok(!("valueAtMarketCents" in row.stock));
  }
});

test("the order detail payload is clean for a warehouseman", async () => {
  const warehouse = await getOrderDetail(fixture.orderId, "WAREHOUSEMAN");
  assert.ok(warehouse, "the order exists");

  const hits = findForbiddenKeys(warehouse, "WAREHOUSEMAN");
  assert.deepEqual(hits, [], `leaked: ${hits.join(", ")}`);

  // The warehouse still gets everything it needs to pick the order.
  assert.equal(warehouse.lines.length, 1);
  assert.equal(warehouse.lines[0].qtyOrderedUnits, 30);
  assert.ok(warehouse.summary.totalWeightKg > 0);

  // The Director's copy of the same order does carry the money.
  const director = await getOrderDetail(fixture.orderId, "DIRECTOR");
  assert.equal(director?.totalCents, 850 * 30);
  assert.equal(director?.lines[0].unitPriceCents, 850);
});

test("the order list payload is clean for a warehouseman", async () => {
  const { rows } = await listOrders("WAREHOUSEMAN", { pageSize: 200 });
  const hits = findForbiddenKeys(rows, "WAREHOUSEMAN");
  assert.deepEqual(hits, [], `leaked: ${hits.join(", ")}`);

  const director = await listOrders("DIRECTOR", { pageSize: 200 });
  const target = director.rows.find((r) => r.id === fixture.orderId);
  assert.equal(target?.totalCents, 850 * 30);
});

test("the product picker payload is clean for a warehouseman", async () => {
  const options = await listProductOptions("WAREHOUSEMAN");
  const hits = findForbiddenKeys(options, "WAREHOUSEMAN");
  assert.deepEqual(hits, [], `leaked: ${hits.join(", ")}`);

  const forSales = await listProductOptions("SALESPERSON");
  const one = forSales.find((o) => o.id === fixture.productId);
  assert.equal(one?.marketPriceCents, 900, "a salesperson may price an order");
});

// ---------------------------------------------------------------------------
// The permission matrix (§2.2)
// ---------------------------------------------------------------------------

test("the §2.2 matrix is enforced by the permission module", () => {
  const director = { id: "1", role: "DIRECTOR" as Role };
  const warehouse = { id: "2", role: "WAREHOUSEMAN" as Role };
  const sales = { id: "3", role: "SALESPERSON" as Role };

  // Cost price and margins: Director only.
  assert.equal(can.seeCost(director), true);
  assert.equal(can.seeCost(warehouse), false);
  assert.equal(can.seeCost(sales), false);

  // Market & export prices: Director full, Salesperson read, Warehouseman none.
  assert.equal(can.seeSalePrices(director), true);
  assert.equal(can.seeSalePrices(sales), true);
  assert.equal(can.seeSalePrices(warehouse), false);

  // Stock values in $: Director only.
  assert.equal(can.seeStockValue(director), true);
  assert.equal(can.seeStockValue(warehouse), false);
  assert.equal(can.seeStockValue(sales), false);

  // Expenses: Director only.
  assert.equal(can.manageExpenses(director), true);
  assert.equal(can.manageExpenses(warehouse), false);
  assert.equal(can.manageExpenses(sales), false);

  // Goods receipt and counts: the warehouse's job.
  assert.equal(can.createReceipt(warehouse), true);
  assert.equal(can.createReceipt(sales), false);
  assert.equal(can.approveCount(warehouse), false, "approval is the Director's");
  assert.equal(can.approveCount(director), true);

  // Accept / pick / ship: the warehouse's job, not the salesperson's.
  assert.equal(can.fulfilOrder(warehouse), true);
  assert.equal(can.fulfilOrder(sales), false);

  // Payments, receivables, returns, audit, users, settings: Director only.
  for (const check of [
    can.managePayments,
    can.viewReceivables,
    can.manageReturns,
    can.viewAudit,
    can.manageUsers,
    can.manageSettings,
    can.viewProfit,
  ]) {
    assert.equal(check(director), true);
    assert.equal(check(warehouse), false);
    assert.equal(check(sales), false);
  }

  // A salesperson only ever sees their own orders.
  assert.equal(can.viewAllOrders(sales), false);
  assert.equal(can.editOrder(sales, { createdById: "3" }), true);
  assert.equal(can.editOrder(sales, { createdById: "other" }), false);
  assert.equal(can.editOrder(director, { createdById: "other" }), true);
});

test("section gating matches the matrix, longest prefix winning", () => {
  // The queue is warehouse work; orders are visible to all three.
  assert.equal(isPathAllowed("/queue", "WAREHOUSEMAN"), true);
  assert.equal(isPathAllowed("/queue", "SALESPERSON"), false);
  assert.equal(isPathAllowed("/orders", "SALESPERSON"), true);
  assert.equal(isPathAllowed("/orders/abc/edit", "SALESPERSON"), true);

  // Money and admin sections are Director-only.
  for (const path of [
    "/expenses",
    "/expenses/categories",
    "/receivables",
    "/returns",
    "/audit",
    "/settings",
    "/admin/users",
    "/frozen",
  ]) {
    assert.equal(isPathAllowed(path, "DIRECTOR"), true, path);
    assert.equal(isPathAllowed(path, "WAREHOUSEMAN"), false, path);
    assert.equal(isPathAllowed(path, "SALESPERSON"), false, path);
  }

  // Warehouse sections exclude the salesperson.
  for (const path of ["/receipts", "/counts", "/produce"]) {
    assert.equal(isPathAllowed(path, "WAREHOUSEMAN"), true, path);
    assert.equal(isPathAllowed(path, "SALESPERSON"), false, path);
  }

  // An ungated path is allowed rather than silently blocked.
  assert.equal(sectionRoles("/something-new"), null);
  assert.equal(isPathAllowed("/something-new", "WAREHOUSEMAN"), true);
});
