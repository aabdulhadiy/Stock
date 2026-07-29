import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Executor, type Tx } from "@/db";
import {
  orderItems,
  orders,
  productStock,
  stockMovements,
  type MovementType,
} from "@/db/schema";

/**
 * The stock ledger and the reservation engine (§4, §6).
 *
 * Two invariants hold at all times, and every function here exists to keep
 * them true:
 *
 *   on_hand(p)  = Σ stock_movements.qty_units          (the ledger is truth)
 *   reserved(p) = Σ order_items.reserved_qty over orders in PICKING / READY
 *
 * `product_stock` caches both for fast reads, and — critically — is the row
 * that gets locked. Every reservation path locks the product's stock row
 * `FOR UPDATE` before reading `available`, which is what makes BR-9 hold:
 * two warehousemen accepting different orders for the same product at the same
 * instant serialise on that row, so the second one sees the first one's
 * reservation and reports a shortfall instead of over-reserving.
 *
 * Rows are always locked in a deterministic order (sorted by product id) so
 * two multi-line orders touching the same products cannot deadlock each other.
 */

/** Statuses whose reservations count against Available (BR-3). */
export const RESERVING_STATUSES = ["PICKING", "READY"] as const;

export class InsufficientStockError extends Error {
  constructor(
    public productId: string,
    public available: number,
    public requested: number,
  ) {
    super(`Insufficient stock: requested ${requested}, available ${available}`);
    this.name = "InsufficientStockError";
  }
}

export interface StockRow {
  onHand: number;
  reserved: number;
  available: number;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getStock(
  productId: string,
  exec: Executor = db,
): Promise<StockRow> {
  const [row] = await exec
    .select({ onHand: productStock.onHand, reserved: productStock.reserved })
    .from(productStock)
    .where(eq(productStock.productId, productId));
  const onHand = row?.onHand ?? 0;
  const reserved = row?.reserved ?? 0;
  return { onHand, reserved, available: onHand - reserved };
}

/** Stock for many products at once, for list screens. */
export async function getStockMap(
  productIds: string[],
  exec: Executor = db,
): Promise<Map<string, StockRow>> {
  const out = new Map<string, StockRow>();
  if (productIds.length === 0) return out;
  const rows = await exec
    .select({
      productId: productStock.productId,
      onHand: productStock.onHand,
      reserved: productStock.reserved,
    })
    .from(productStock)
    .where(inArray(productStock.productId, productIds));
  for (const r of rows) {
    out.set(r.productId, {
      onHand: r.onHand,
      reserved: r.reserved,
      available: r.onHand - r.reserved,
    });
  }
  for (const id of productIds) {
    if (!out.has(id)) out.set(id, { onHand: 0, reserved: 0, available: 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

/**
 * Make sure a product's stock row exists. Called when a product is created and
 * defensively before locking, so `SELECT … FOR UPDATE` always has a row to
 * take a lock on.
 */
export async function ensureStockRow(exec: Executor, productId: string): Promise<void> {
  await exec
    .insert(productStock)
    .values({ productId, onHand: 0, reserved: 0 })
    .onConflictDoNothing({ target: productStock.productId });
}

/**
 * Lock one product's stock row and return the current figures. Must be called
 * inside a transaction — outside one, the lock would be released immediately
 * and provide no protection.
 */
export async function lockStock(tx: Tx, productId: string): Promise<StockRow> {
  await ensureStockRow(tx, productId);
  const rows = await tx.execute(sql`
    SELECT on_hand, reserved FROM product_stock
     WHERE product_id = ${productId}
       FOR UPDATE
  `);
  const row = (rows as unknown as { on_hand: number; reserved: number }[])[0];
  const onHand = Number(row?.on_hand ?? 0);
  const reserved = Number(row?.reserved ?? 0);
  return { onHand, reserved, available: onHand - reserved };
}

/**
 * Lock several products' stock rows in a stable order. Sorting the ids is what
 * prevents two concurrent multi-line orders from deadlocking (order A locks
 * product 1 then 2 while order B locks 2 then 1).
 */
export async function lockStockMany(
  tx: Tx,
  productIds: string[],
): Promise<Map<string, StockRow>> {
  const unique = [...new Set(productIds)].sort();
  const out = new Map<string, StockRow>();
  for (const id of unique) {
    out.set(id, await lockStock(tx, id));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export interface MovementInput {
  productId: string;
  type: MovementType;
  /** Signed: RECEIPT/RETURN positive, SHIPMENT negative, ADJUSTMENT either. */
  qtyUnits: number;
  movementDate: string; // YYYY-MM-DD
  userId?: string | null;
  orderId?: string | null;
  returnId?: string | null;
  inventoryCountId?: string | null;
  note?: string | null;
}

/**
 * Write a ledger row and move the cached on-hand by the same signed amount.
 * Refuses to drive on-hand negative — you cannot ship or adjust away stock
 * that is not physically there.
 *
 * The caller must already hold the product's stock lock when the movement is
 * part of a decision that read `available` (shipping, adjustments).
 */
export async function applyMovement(
  tx: Tx,
  input: MovementInput,
): Promise<void> {
  if (!Number.isInteger(input.qtyUnits) || input.qtyUnits === 0) {
    throw new Error("Movement quantity must be a non-zero whole number");
  }

  const current = await lockStock(tx, input.productId);
  const nextOnHand = current.onHand + input.qtyUnits;
  if (nextOnHand < 0) {
    throw new InsufficientStockError(
      input.productId,
      current.onHand,
      -input.qtyUnits,
    );
  }
  // Reserved stock is physically present, so on-hand may never fall below it.
  if (nextOnHand < current.reserved) {
    throw new InsufficientStockError(
      input.productId,
      current.onHand - current.reserved,
      -input.qtyUnits,
    );
  }

  await tx.insert(stockMovements).values({
    productId: input.productId,
    type: input.type,
    qtyUnits: input.qtyUnits,
    movementDate: input.movementDate,
    userId: input.userId ?? null,
    orderId: input.orderId ?? null,
    returnId: input.returnId ?? null,
    inventoryCountId: input.inventoryCountId ?? null,
    note: input.note ?? null,
  });

  await tx
    .update(productStock)
    .set({
      onHand: nextOnHand,
      // §3.2: "days in warehouse" runs from the last receipt; frozen-stock
      // classification (§4.3) runs from the last shipment.
      ...(input.type === "RECEIPT" ? { lastReceiptDate: input.movementDate } : {}),
      ...(input.type === "SHIPMENT" ? { lastSaleDate: input.movementDate } : {}),
    })
    .where(eq(productStock.productId, input.productId));
}

// ---------------------------------------------------------------------------
// Reservations (§6)
// ---------------------------------------------------------------------------

export interface ReservationOutcome {
  productId: string;
  ordered: number;
  /** Units held after this operation. */
  reserved: number;
  /** ordered − reserved: becomes a production requirement (§7.3). */
  shortfall: number;
}

/**
 * BR-2 / BR-5: reserve up to the remaining shortfall on each line of an order,
 * taking `reserved = min(remaining_need, available)`.
 *
 * Used both when the warehouseman accepts an order (every line still at zero)
 * and when they press "Reserve available" to top up after a receipt — the
 * arithmetic is identical, which is why there is one function for both.
 *
 * Assumes the caller has verified the order's status. Locks every product row
 * in sorted order first, then writes.
 */
export async function reserveForOrder(
  tx: Tx,
  orderId: string,
): Promise<ReservationOutcome[]> {
  const lines = await tx
    .select({
      id: orderItems.id,
      productId: orderItems.productId,
      ordered: orderItems.qtyOrderedUnits,
      reserved: orderItems.reservedQty,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  // Deterministic lock order across all products this order touches.
  const stocks = await lockStockMany(
    tx,
    lines.map((l) => l.productId),
  );

  // Several lines may reference the same product; track what this pass takes so
  // the second line sees the first line's claim.
  const takenSoFar = new Map<string, number>();
  const outcomes: ReservationOutcome[] = [];

  for (const line of lines) {
    const stock = stocks.get(line.productId)!;
    const alreadyTaken = takenSoFar.get(line.productId) ?? 0;
    const available = stock.onHand - stock.reserved - alreadyTaken;
    const need = line.ordered - line.reserved;
    const take = Math.max(0, Math.min(need, available));

    if (take > 0) {
      takenSoFar.set(line.productId, alreadyTaken + take);
      await tx
        .update(orderItems)
        .set({ reservedQty: line.reserved + take })
        .where(eq(orderItems.id, line.id));
    }

    const reserved = line.reserved + take;
    outcomes.push({
      productId: line.productId,
      ordered: line.ordered,
      reserved,
      shortfall: line.ordered - reserved,
    });
  }

  // Roll the per-product totals into the cache in one update each.
  for (const [productId, taken] of takenSoFar) {
    await tx
      .update(productStock)
      .set({ reserved: sql`${productStock.reserved} + ${taken}` })
      .where(eq(productStock.productId, productId));
  }

  return outcomes;
}

/**
 * BR-7: release every reservation held by an order and zero the lines.
 * Idempotent — releasing an order that holds nothing is a no-op, which is what
 * makes cancelling a NEW order correctly change nothing.
 */
export async function releaseOrderReservations(
  tx: Tx,
  orderId: string,
): Promise<number> {
  const lines = await tx
    .select({
      id: orderItems.id,
      productId: orderItems.productId,
      reserved: orderItems.reservedQty,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const held = lines.filter((l) => l.reserved > 0);
  if (held.length === 0) return 0;

  await lockStockMany(
    tx,
    held.map((l) => l.productId),
  );

  const byProduct = new Map<string, number>();
  for (const line of held) {
    byProduct.set(
      line.productId,
      (byProduct.get(line.productId) ?? 0) + line.reserved,
    );
  }

  await tx
    .update(orderItems)
    .set({ reservedQty: 0, picked: false })
    .where(eq(orderItems.orderId, orderId));

  for (const [productId, qty] of byProduct) {
    await tx
      .update(productStock)
      .set({ reserved: sql`GREATEST(0, ${productStock.reserved} - ${qty})` })
      .where(eq(productStock.productId, productId));
  }

  return [...byProduct.values()].reduce((a, b) => a + b, 0);
}

/**
 * Adjust one line's reservation to a new target (BR-8). Returns the units
 * actually held afterwards, which may be short of the target if stock ran out.
 */
export async function adjustLineReservation(
  tx: Tx,
  lineId: string,
  targetReserved: number,
): Promise<number> {
  const [line] = await tx
    .select({
      productId: orderItems.productId,
      reserved: orderItems.reservedQty,
      ordered: orderItems.qtyOrderedUnits,
    })
    .from(orderItems)
    .where(eq(orderItems.id, lineId));
  if (!line) throw new Error("Order line not found");

  const stock = await lockStock(tx, line.productId);
  const target = Math.max(0, Math.min(targetReserved, line.ordered));

  if (target === line.reserved) return line.reserved;

  let next: number;
  if (target < line.reserved) {
    next = target; // Releasing always succeeds.
  } else {
    const wanted = target - line.reserved;
    const canTake = Math.max(0, stock.onHand - stock.reserved);
    next = line.reserved + Math.min(wanted, canTake);
  }

  const delta = next - line.reserved;
  if (delta !== 0) {
    await tx
      .update(orderItems)
      .set({ reservedQty: next })
      .where(eq(orderItems.id, lineId));
    await tx
      .update(productStock)
      .set({ reserved: sql`GREATEST(0, ${productStock.reserved} + ${delta})` })
      .where(eq(productStock.productId, line.productId));
  }
  return next;
}

/**
 * BR-6: consume the reservations of a shipping order. Each line's reserved
 * quantity leaves the warehouse: a SHIPMENT movement is written, on-hand drops
 * and the reservation is discharged (not released — the units are gone).
 */
export async function consumeReservationsOnShip(
  tx: Tx,
  orderId: string,
  shipDate: string,
  userId: string | null,
): Promise<{ productId: string; qty: number }[]> {
  const lines = await tx
    .select({
      id: orderItems.id,
      productId: orderItems.productId,
      reserved: orderItems.reservedQty,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const shipped = lines.filter((l) => l.reserved > 0);
  if (shipped.length === 0) return [];

  await lockStockMany(
    tx,
    shipped.map((l) => l.productId),
  );

  const byProduct = new Map<string, number>();
  for (const line of shipped) {
    byProduct.set(
      line.productId,
      (byProduct.get(line.productId) ?? 0) + line.reserved,
    );
  }

  for (const [productId, qty] of byProduct) {
    // Discharge the reservation first, so applyMovement's "on-hand may not
    // fall below reserved" guard sees the post-shipment reality.
    await tx
      .update(productStock)
      .set({ reserved: sql`GREATEST(0, ${productStock.reserved} - ${qty})` })
      .where(eq(productStock.productId, productId));

    await applyMovement(tx, {
      productId,
      type: "SHIPMENT",
      qtyUnits: -qty,
      movementDate: shipDate,
      userId,
      orderId,
    });
  }

  return [...byProduct.entries()].map(([productId, qty]) => ({ productId, qty }));
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Rebuild the whole `product_stock` cache from the ledger and the order lines.
 * The ledger is authoritative; this is the maintenance/verification step that
 * proves the cache never drifted (and the assertion the tests use).
 */
export async function recomputeStock(exec: Executor = db): Promise<void> {
  await exec.execute(sql`
    INSERT INTO product_stock (product_id, on_hand, reserved, last_receipt_date, last_sale_date)
    SELECT
      p.id,
      COALESCE(m.on_hand, 0),
      COALESCE(r.reserved, 0),
      m.last_receipt_date,
      m.last_sale_date
    FROM products p
    LEFT JOIN (
      SELECT product_id,
             SUM(qty_units)                                                AS on_hand,
             MAX(movement_date) FILTER (WHERE type = 'RECEIPT')            AS last_receipt_date,
             MAX(movement_date) FILTER (WHERE type = 'SHIPMENT')           AS last_sale_date
        FROM stock_movements
       GROUP BY product_id
    ) m ON m.product_id = p.id
    LEFT JOIN (
      SELECT oi.product_id, SUM(oi.reserved_qty) AS reserved
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN ('PICKING', 'READY')
       GROUP BY oi.product_id
    ) r ON r.product_id = p.id
    ON CONFLICT (product_id) DO UPDATE SET
      on_hand           = EXCLUDED.on_hand,
      reserved          = EXCLUDED.reserved,
      last_receipt_date = EXCLUDED.last_receipt_date,
      last_sale_date    = EXCLUDED.last_sale_date
  `);
}

/**
 * Independent recomputation of the two invariants, used by the reconciliation
 * tests and available as an operational health check.
 */
export async function auditStockInvariants(
  exec: Executor = db,
): Promise<
  {
    productId: string;
    cachedOnHand: number;
    ledgerOnHand: number;
    cachedReserved: number;
    derivedReserved: number;
  }[]
> {
  const rows = await exec.execute(sql`
    SELECT
      ps.product_id                     AS product_id,
      ps.on_hand                        AS cached_on_hand,
      COALESCE(m.on_hand, 0)            AS ledger_on_hand,
      ps.reserved                       AS cached_reserved,
      COALESCE(r.reserved, 0)           AS derived_reserved
    FROM product_stock ps
    LEFT JOIN (
      SELECT product_id, SUM(qty_units) AS on_hand
        FROM stock_movements GROUP BY product_id
    ) m ON m.product_id = ps.product_id
    LEFT JOIN (
      SELECT oi.product_id, SUM(oi.reserved_qty) AS reserved
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN ('PICKING', 'READY')
       GROUP BY oi.product_id
    ) r ON r.product_id = ps.product_id
    WHERE ps.on_hand <> COALESCE(m.on_hand, 0)
       OR ps.reserved <> COALESCE(r.reserved, 0)
  `);

  return (
    rows as unknown as {
      product_id: string;
      cached_on_hand: number;
      ledger_on_hand: number;
      cached_reserved: number;
      derived_reserved: number;
    }[]
  ).map((r) => ({
    productId: r.product_id,
    cachedOnHand: Number(r.cached_on_hand),
    ledgerOnHand: Number(r.ledger_on_hand),
    cachedReserved: Number(r.cached_reserved),
    derivedReserved: Number(r.derived_reserved),
  }));
}

/**
 * The consolidated "to produce" list (§7.3): every unfilled shortfall across
 * accepted orders, with the orders that are waiting.
 */
export async function getShortfalls(exec: Executor = db): Promise<
  {
    productId: string;
    sku: string;
    name: string;
    shortTotal: number;
    orders: { id: string; number: string; short: number }[];
  }[]
> {
  const rows = await exec
    .select({
      productId: orderItems.productId,
      orderId: orders.id,
      number: orders.number,
      ordered: orderItems.qtyOrderedUnits,
      reserved: orderItems.reservedQty,
      sku: sql<string>`p.sku`,
      name: sql<string>`p.name`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(sql`products p`, sql`p.id = ${orderItems.productId}`)
    .where(
      and(
        inArray(orders.status, ["PICKING", "READY"]),
        sql`${orderItems.reservedQty} < ${orderItems.qtyOrderedUnits}`,
      ),
    );

  const byProduct = new Map<
    string,
    {
      productId: string;
      sku: string;
      name: string;
      shortTotal: number;
      orders: { id: string; number: string; short: number }[];
    }
  >();

  for (const r of rows) {
    const short = r.ordered - r.reserved;
    const entry = byProduct.get(r.productId) ?? {
      productId: r.productId,
      sku: r.sku,
      name: r.name,
      shortTotal: 0,
      orders: [],
    };
    entry.shortTotal += short;
    entry.orders.push({ id: r.orderId, number: r.number, short });
    byProduct.set(r.productId, entry);
  }

  return [...byProduct.values()].sort((a, b) => b.shortTotal - a.shortTotal);
}
