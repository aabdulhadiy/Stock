import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Executor, type Tx } from "@/db";
import {
  customers,
  orderItems,
  orders,
  products,
  type EnteredAs,
  type OrderStatus,
  type PaymentMethod,
  type PriceType,
} from "@/db/schema";
import {
  adjustLineReservation,
  consumeReservationsOnShip,
  releaseOrderReservations,
  reserveForOrder,
  type ReservationOutcome,
} from "@/lib/stock";
import { writeAudit, type AuditInput } from "@/lib/audit";
import { formatOrderNumber, getSettings } from "@/lib/settings";
import { toUnits } from "@/lib/validation";
import { addDays } from "@/lib/dates";
import { col } from "@/lib/sql";

/**
 * Order lifecycle (§5, §6, §7).
 *
 * Every transition is a single transaction that (a) checks the current status
 * is a legal starting point, (b) moves reservations, and (c) writes the audit
 * entry — so a rejected transition leaves nothing behind, and an accepted one
 * is always accounted for.
 *
 * The status machine, from §5.3:
 *
 *   NEW ──accept──> PICKING ──markReady──> READY ──ship──> SHIPPED
 *    │                 │                     │
 *    └────────────── cancel ─────────────────┘        (SHIPPED is terminal)
 */

export class OrderStateError extends Error {
  constructor(
    public status: OrderStatus,
    public reason:
      | "WRONG_STATUS"
      | "NOT_FULLY_RESERVED"
      | "NOT_ALL_PICKED"
      | "NO_LINES" = "WRONG_STATUS",
  ) {
    super(`Order in status ${status}: ${reason}`);
    this.name = "OrderStateError";
  }
}

export class ArchivedProductError extends Error {
  constructor(public productName: string) {
    super(`Product ${productName} is archived`);
    this.name = "ArchivedProductError";
  }
}

/** Transitions permitted out of each status. */
const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  NEW: ["PICKING", "CANCELLED"],
  PICKING: ["READY", "CANCELLED"],
  READY: ["SHIPPED", "CANCELLED", "PICKING"],
  SHIPPED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** An order may still be edited while it has not shipped or been cancelled. */
export function isEditable(status: OrderStatus): boolean {
  return status === "NEW" || status === "PICKING" || status === "READY";
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/**
 * Allocate the next order number for the year (§5.1).
 *
 * The counter row is locked with an atomic upsert-returning, so two orders
 * created at the same moment cannot take the same sequence — the unique index
 * on `orders.number` is the backstop, but this avoids ever hitting it.
 */
export async function nextOrderNumber(tx: Tx, when: Date = new Date()): Promise<string> {
  const year = when.getFullYear();
  const key = `order:${year}`;

  const rows = await tx.execute(sql`
    INSERT INTO sequences (key, value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1
    RETURNING value
  `);
  const seq = Number((rows as unknown as { value: number }[])[0]?.value ?? 1);

  const settings = await getSettings(tx);
  return formatOrderNumber(settings.orderNumberFormat, year, seq);
}

// ---------------------------------------------------------------------------
// Creation & editing
// ---------------------------------------------------------------------------

export interface OrderLineInput {
  productId: string;
  /** As typed by the user. */
  qty: number;
  enteredAs: EnteredAs;
  /** Actual sold price in cents; may differ from the catalog price (§5.2). */
  unitPriceCents: number;
}

export interface OrderHeaderInput {
  customerId: string;
  priceType: PriceType;
  plannedShipDate: string;
  paymentMethod: PaymentMethod;
  paymentTermDays: number;
  note: string | null;
}

interface ProductFacts {
  id: string;
  sku: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  unitsPerBox: number;
  unitsPerBag: number | null;
  marketPriceCents: number;
  exportPriceCents: number;
}

async function loadProducts(
  exec: Executor,
  ids: string[],
): Promise<Map<string, ProductFacts>> {
  if (ids.length === 0) return new Map();
  const rows = await exec
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      status: products.status,
      unitsPerBox: products.unitsPerBox,
      unitsPerBag: products.unitsPerBag,
      marketPriceCents: products.marketPriceCents,
      exportPriceCents: products.exportPriceCents,
    })
    .from(products)
    .where(inArray(products.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}

/** The catalog price a line defaults to, given the order's price type. */
export function basePriceFor(product: ProductFacts, priceType: PriceType): number {
  return priceType === "EXPORT" ? product.exportPriceCents : product.marketPriceCents;
}

export interface CreateOrderResult {
  orderId: string;
  number: string;
}

export async function createOrder(
  actorId: string,
  header: OrderHeaderInput,
  lines: OrderLineInput[],
): Promise<CreateOrderResult> {
  if (lines.length === 0) throw new OrderStateError("NEW", "NO_LINES");

  return db.transaction(async (tx) => {
    const facts = await loadProducts(
      tx,
      lines.map((l) => l.productId),
    );

    // §3.1: archived products cannot be added to new orders.
    for (const line of lines) {
      const product = facts.get(line.productId);
      if (!product) throw new OrderStateError("NEW", "NO_LINES");
      if (product.status === "ARCHIVED") throw new ArchivedProductError(product.name);
    }

    const number = await nextOrderNumber(tx);

    const [order] = await tx
      .insert(orders)
      .values({
        number,
        customerId: header.customerId,
        priceType: header.priceType,
        status: "NEW",
        createdById: actorId,
        plannedShipDate: header.plannedShipDate,
        paymentMethod: header.paymentMethod,
        paymentTermDays: header.paymentTermDays,
        note: header.note,
        totalCents: 0,
      })
      .returning({ id: orders.id });

    let total = 0;
    for (const line of lines) {
      const product = facts.get(line.productId)!;
      const qtyUnits = toUnits(line.qty, line.enteredAs, product);
      total += line.unitPriceCents * qtyUnits;

      await tx.insert(orderItems).values({
        orderId: order.id,
        productId: line.productId,
        qtyOrderedUnits: qtyUnits,
        enteredAs: line.enteredAs,
        enteredQty: line.qty,
        unitPriceCents: line.unitPriceCents,
        basePriceSnapshotCents: basePriceFor(product, header.priceType),
        // BR-1: creating an order reserves nothing.
        reservedQty: 0,
      });
    }

    await tx.update(orders).set({ totalCents: total }).where(eq(orders.id, order.id));

    await writeAudit(
      {
        userId: actorId,
        entity: "order",
        entityId: order.id,
        action: "create",
        label: number,
        newValue: {
          customerId: header.customerId,
          priceType: header.priceType,
          plannedShipDate: header.plannedShipDate,
          paymentMethod: header.paymentMethod,
          paymentTermDays: header.paymentTermDays,
          lines: lines.length,
          totalCents: total,
        },
      },
      tx,
    );

    return { orderId: order.id, number };
  });
}

/**
 * Replace an order's header and lines (§5.2, BR-8).
 *
 * While the order is NEW this is a plain edit. Once it is PICKING or READY,
 * every quantity change also moves the reservation: a decrease releases the
 * difference, an increase tries to take more from Available and reports a
 * shortfall if it cannot.
 *
 * Line price changes are audited individually, old -> new, per §5.2/§12.
 */
export async function updateOrder(
  actorId: string,
  orderId: string,
  header: OrderHeaderInput,
  lines: (OrderLineInput & { id?: string })[],
): Promise<void> {
  if (lines.length === 0) throw new OrderStateError("NEW", "NO_LINES");

  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new OrderStateError("CANCELLED", "WRONG_STATUS");
    if (!isEditable(order.status)) throw new OrderStateError(order.status);

    const existing = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    const existingById = new Map(existing.map((l) => [l.id, l]));

    const facts = await loadProducts(
      tx,
      lines.map((l) => l.productId),
    );
    for (const line of lines) {
      const product = facts.get(line.productId);
      if (!product) throw new OrderStateError(order.status, "NO_LINES");
      // An already-ordered archived product may stay; a newly added one may not.
      const isNew = !line.id || !existingById.has(line.id);
      if (isNew && product.status === "ARCHIVED") {
        throw new ArchivedProductError(product.name);
      }
    }

    const auditEntries: AuditInput[] = [];
    const keptIds = new Set<string>();
    let total = 0;

    for (const line of lines) {
      const product = facts.get(line.productId)!;
      const qtyUnits = toUnits(line.qty, line.enteredAs, product);
      total += line.unitPriceCents * qtyUnits;

      const prior = line.id ? existingById.get(line.id) : undefined;

      if (!prior) {
        const [inserted] = await tx
          .insert(orderItems)
          .values({
            orderId,
            productId: line.productId,
            qtyOrderedUnits: qtyUnits,
            enteredAs: line.enteredAs,
            enteredQty: line.qty,
            unitPriceCents: line.unitPriceCents,
            basePriceSnapshotCents: basePriceFor(product, header.priceType),
            reservedQty: 0,
          })
          .returning({ id: orderItems.id });
        keptIds.add(inserted.id);

        // A line added to an accepted order should reserve straight away, the
        // same as if it had been there at acceptance (BR-8).
        if (order.status === "PICKING" || order.status === "READY") {
          await adjustLineReservation(tx, inserted.id, qtyUnits);
        }
        continue;
      }

      keptIds.add(prior.id);

      const priceChanged = prior.unitPriceCents !== line.unitPriceCents;
      const productChanged = prior.productId !== line.productId;
      const qtyChanged = prior.qtyOrderedUnits !== qtyUnits;

      // Changing the product on a reserved line means releasing the old
      // product's hold before the new one can take any.
      if (productChanged && prior.reservedQty > 0) {
        await adjustLineReservation(tx, prior.id, 0);
      }

      await tx
        .update(orderItems)
        .set({
          productId: line.productId,
          qtyOrderedUnits: qtyUnits,
          enteredAs: line.enteredAs,
          enteredQty: line.qty,
          unitPriceCents: line.unitPriceCents,
          ...(productChanged
            ? { basePriceSnapshotCents: basePriceFor(product, header.priceType) }
            : {}),
          // A quantity or product change invalidates a previous "picked" tick.
          ...(qtyChanged || productChanged ? { picked: false } : {}),
        })
        .where(eq(orderItems.id, prior.id));

      if ((qtyChanged || productChanged) && (order.status === "PICKING" || order.status === "READY")) {
        await adjustLineReservation(tx, prior.id, qtyUnits);
      }

      if (priceChanged) {
        auditEntries.push({
          userId: actorId,
          entity: "order_item",
          entityId: prior.id,
          action: "price_change",
          label: `${order.number} · ${product.sku}`,
          oldValue: { unitPriceCents: prior.unitPriceCents },
          newValue: { unitPriceCents: line.unitPriceCents },
        });
      }
      if (qtyChanged) {
        auditEntries.push({
          userId: actorId,
          entity: "order_item",
          entityId: prior.id,
          action: "update",
          label: `${order.number} · ${product.sku}`,
          oldValue: { qtyOrderedUnits: prior.qtyOrderedUnits },
          newValue: { qtyOrderedUnits: qtyUnits },
        });
      }
    }

    // Lines the user removed: release their hold, then delete.
    const removed = existing.filter((l) => !keptIds.has(l.id));
    for (const line of removed) {
      if (line.reservedQty > 0) await adjustLineReservation(tx, line.id, 0);
      await tx.delete(orderItems).where(eq(orderItems.id, line.id));
      auditEntries.push({
        userId: actorId,
        entity: "order_item",
        entityId: line.id,
        action: "delete",
        label: order.number,
        oldValue: { qtyOrderedUnits: line.qtyOrderedUnits },
      });
    }

    // If a READY order's lines no longer add up, it drops back to PICKING.
    let status = order.status;
    if (status === "READY") {
      const after = await tx
        .select({
          ordered: orderItems.qtyOrderedUnits,
          reserved: orderItems.reservedQty,
          picked: orderItems.picked,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));
      const complete = after.every((l) => l.reserved >= l.ordered && l.picked);
      if (!complete) status = "PICKING";
    }

    await tx
      .update(orders)
      .set({
        customerId: header.customerId,
        priceType: header.priceType,
        plannedShipDate: header.plannedShipDate,
        paymentMethod: header.paymentMethod,
        paymentTermDays: header.paymentTermDays,
        note: header.note,
        totalCents: total,
        status,
      })
      .where(eq(orders.id, orderId));

    await writeAudit(
      {
        userId: actorId,
        entity: "order",
        entityId: orderId,
        action: "update",
        label: order.number,
        oldValue: {
          totalCents: order.totalCents,
          priceType: order.priceType,
          plannedShipDate: order.plannedShipDate,
          status: order.status,
        },
        newValue: {
          totalCents: total,
          priceType: header.priceType,
          plannedShipDate: header.plannedShipDate,
          status,
        },
      },
      tx,
    );
    for (const entry of auditEntries) await writeAudit(entry, tx);
  });
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * BR-2: the warehouseman accepts the order. This — not creation — is the moment
 * stock is reserved, taking `min(ordered, available)` per line.
 */
export async function acceptOrder(
  actorId: string,
  orderId: string,
): Promise<ReservationOutcome[]> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new OrderStateError("CANCELLED");
    if (order.status !== "NEW") throw new OrderStateError(order.status);

    await tx
      .update(orders)
      .set({ status: "PICKING", acceptedAt: new Date(), acceptedById: actorId })
      .where(eq(orders.id, orderId));

    const outcomes = await reserveForOrder(tx, orderId);

    await writeAudit(
      {
        userId: actorId,
        entity: "order",
        entityId: orderId,
        action: "accept",
        label: order.number,
        oldValue: { status: "NEW" },
        newValue: {
          status: "PICKING",
          reserved: outcomes.reduce((s, o) => s + o.reserved, 0),
          shortfall: outcomes.reduce((s, o) => s + o.shortfall, 0),
        },
      },
      tx,
    );

    return outcomes;
  });
}

/**
 * BR-5: explicit top-up after a receipt. Reserves up to each line's remaining
 * shortfall — never silently, always because someone pressed the button.
 */
export async function reserveAvailableForOrder(
  actorId: string,
  orderId: string,
): Promise<{ outcomes: ReservationOutcome[]; gained: number }> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new OrderStateError("CANCELLED");
    if (order.status !== "PICKING" && order.status !== "READY") {
      throw new OrderStateError(order.status);
    }

    const before = await tx
      .select({ reserved: orderItems.reservedQty })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    const heldBefore = before.reduce((s, l) => s + l.reserved, 0);

    const outcomes = await reserveForOrder(tx, orderId);
    const heldAfter = outcomes.reduce((s, o) => s + o.reserved, 0);
    const gained = heldAfter - heldBefore;

    if (gained > 0) {
      await writeAudit(
        {
          userId: actorId,
          entity: "order",
          entityId: orderId,
          action: "reserve",
          label: order.number,
          newValue: { gained, reserved: heldAfter },
        },
        tx,
      );
    }

    return { outcomes, gained };
  });
}

/** Tick a line off physically (§7.2). */
export async function setLinePicked(
  actorId: string,
  lineId: string,
  picked: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [line] = await tx
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        status: orders.status,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(orderItems.id, lineId));
    if (!line) return;
    if (line.status !== "PICKING" && line.status !== "READY") {
      throw new OrderStateError(line.status);
    }
    await tx.update(orderItems).set({ picked }).where(eq(orderItems.id, lineId));
  });
  void actorId;
}

/**
 * PICKING → READY. §5.3: every line must be fully reserved *and* picked. This
 * is where partial shipment is refused — the Director edits the quantities
 * instead (BR-8).
 */
export async function markOrderReady(actorId: string, orderId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new OrderStateError("CANCELLED");
    if (order.status !== "PICKING") throw new OrderStateError(order.status);

    const lines = await tx
      .select({
        ordered: orderItems.qtyOrderedUnits,
        reserved: orderItems.reservedQty,
        picked: orderItems.picked,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    if (lines.length === 0) throw new OrderStateError(order.status, "NO_LINES");
    if (lines.some((l) => l.reserved < l.ordered)) {
      throw new OrderStateError(order.status, "NOT_FULLY_RESERVED");
    }
    if (lines.some((l) => !l.picked)) {
      throw new OrderStateError(order.status, "NOT_ALL_PICKED");
    }

    await tx.update(orders).set({ status: "READY" }).where(eq(orders.id, orderId));
    await writeAudit(
      {
        userId: actorId,
        entity: "order",
        entityId: orderId,
        action: "status_change",
        label: order.number,
        oldValue: { status: "PICKING" },
        newValue: { status: "READY" },
      },
      tx,
    );
  });
}

/**
 * BR-6: ship. The reservation is consumed, on-hand drops, and each line's cost
 * is snapshotted — after this, editing a product's cost price cannot rewrite
 * historical profit.
 */
export async function shipOrder(
  actorId: string,
  orderId: string,
  shipDate: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new OrderStateError("CANCELLED");
    if (order.status !== "READY") throw new OrderStateError(order.status);

    // Freeze cost per line before the stock movement.
    const lines = await tx
      .select({
        id: orderItems.id,
        productId: orderItems.productId,
        costPriceCents: products.costPriceCents,
      })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orderItems.orderId, orderId));

    for (const line of lines) {
      await tx
        .update(orderItems)
        .set({ costSnapshotCents: line.costPriceCents })
        .where(eq(orderItems.id, line.id));
    }

    await consumeReservationsOnShip(tx, orderId, shipDate, actorId);

    // §5.4: the credit clock starts at the actual ship date.
    const dueDate = addDays(shipDate, order.paymentTermDays);

    await tx
      .update(orders)
      .set({
        status: "SHIPPED",
        actualShipDate: shipDate,
        shippedAt: new Date(),
        dueDate,
      })
      .where(eq(orders.id, orderId));

    await writeAudit(
      {
        userId: actorId,
        entity: "order",
        entityId: orderId,
        action: "ship",
        label: order.number,
        oldValue: { status: "READY" },
        newValue: { status: "SHIPPED", actualShipDate: shipDate, dueDate },
      },
      tx,
    );
  });
}

/**
 * BR-7: cancel. Reservations go back to Available immediately; cancelling a NEW
 * order releases nothing because nothing was ever held.
 */
export async function cancelOrder(actorId: string, orderId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new OrderStateError("CANCELLED");
    if (!canTransition(order.status, "CANCELLED")) {
      throw new OrderStateError(order.status);
    }

    const released = await releaseOrderReservations(tx, orderId);

    await tx
      .update(orders)
      .set({ status: "CANCELLED", cancelledAt: new Date() })
      .where(eq(orders.id, orderId));

    await writeAudit(
      {
        userId: actorId,
        entity: "order",
        entityId: orderId,
        action: "cancel",
        label: order.number,
        oldValue: { status: order.status },
        newValue: { status: "CANCELLED", released },
      },
      tx,
    );

    return released;
  });
}

// ---------------------------------------------------------------------------
// Picking summary (§7.4)
// ---------------------------------------------------------------------------

export interface PickingSummary {
  totalWeightKg: number;
  totalVolumeM3: number;
  distinctProducts: number;
  totalUnits: number;
  totalBoxes: number;
}

/**
 * §7.4 totals for a picking list. Weight respects the product's basis: a
 * per-box weight must be multiplied by boxes, not by units, or a 600-unit line
 * would be reported at fifty times its real weight.
 */
export function pickingSummary(
  lines: {
    productId: string;
    qtyUnits: number;
    unitsPerBox: number;
    unitsPerBag: number | null;
    weightKg: string | number;
    weightBasis: "UNIT" | "BOX";
    boxVolumeM3: string | number;
    bagVolumeM3: string | number | null;
    enteredAs: EnteredAs;
  }[],
): PickingSummary {
  let weight = 0;
  let volume = 0;
  let units = 0;
  let boxes = 0;
  const distinct = new Set<string>();

  for (const line of lines) {
    distinct.add(line.productId);
    const perBox = Math.max(1, line.unitsPerBox);
    const lineBoxes = line.qtyUnits / perBox;
    units += line.qtyUnits;
    boxes += Math.ceil(lineBoxes);

    weight +=
      line.weightBasis === "UNIT"
        ? Number(line.weightKg) * line.qtyUnits
        : Number(line.weightKg) * lineBoxes;

    // Bag-entered lines occupy bag volume; everything else ships in boxes.
    if (line.enteredAs === "BAGS" && line.bagVolumeM3 && line.unitsPerBag) {
      volume += Number(line.bagVolumeM3) * (line.qtyUnits / Math.max(1, line.unitsPerBag));
    } else {
      volume += Number(line.boxVolumeM3) * lineBoxes;
    }
  }

  return {
    // Round for display; the inputs are measurements, not currency.
    totalWeightKg: Math.round(weight * 1000) / 1000,
    totalVolumeM3: Math.round(volume * 1_000_000) / 1_000_000,
    distinctProducts: distinct.size,
    totalUnits: units,
    totalBoxes: boxes,
  };
}

// ---------------------------------------------------------------------------
// Customer defaults (§5.1, §8.1)
// ---------------------------------------------------------------------------

export async function getCustomerDefaults(
  customerId: string,
  exec: Executor = db,
): Promise<{ priceType: PriceType; termDays: number } | null> {
  const [row] = await exec
    .select({
      defaultPriceType: customers.defaultPriceType,
      defaultTermDays: customers.defaultTermDays,
    })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!row) return null;
  return {
    priceType: row.defaultPriceType,
    termDays: row.defaultTermDays ?? 0,
  };
}

/** Count of orders awaiting acceptance, for the queue badge (§7.1). */
export async function countNewOrders(exec: Executor = db): Promise<number> {
  const [row] = await exec
    .select({ n: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.status, "NEW"));
  return Number(row?.n ?? 0);
}

/** Orders whose product just arrived and that are still short (BR-5 alert). */
export async function getTopUpAlerts(
  exec: Executor = db,
): Promise<{ orderId: string; number: string; productName: string; short: number }[]> {
  const rows = await exec
    .select({
      orderId: orders.id,
      number: orders.number,
      productName: products.name,
      ordered: orderItems.qtyOrderedUnits,
      reserved: orderItems.reservedQty,
      available: sql<number>`COALESCE((
        SELECT ps.on_hand - ps.reserved FROM product_stock ps
         WHERE ps.product_id = ${col(orderItems.productId)}
      ), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(
      and(
        inArray(orders.status, ["PICKING", "READY"]),
        sql`${orderItems.reservedQty} < ${orderItems.qtyOrderedUnits}`,
      ),
    );

  // Only surface an alert when there is actually something to reserve now.
  return rows
    .filter((r) => Number(r.available) > 0)
    .map((r) => ({
      orderId: r.orderId,
      number: r.number,
      productName: r.productName,
      short: r.ordered - r.reserved,
    }));
}
