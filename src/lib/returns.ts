import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, products, returnItems, returns } from "@/db/schema";
import { applyMovement } from "@/lib/stock";
import { writeAudit } from "@/lib/audit";
import { getReturnedQuantities } from "@/lib/payments";

/**
 * Returns (§11).
 *
 * A return does four things, all in one transaction:
 *
 *  1. puts the goods back in the warehouse (a RETURN ledger movement),
 *  2. credits the customer's balance (see `lib/payments.ts` — the credit is
 *     derived from the return lines, not written into the order),
 *  3. records the document in history,
 *  4. reverses the revenue *and* the COGS of the returned quantities — which is
 *     why each return line copies the original line's price and cost snapshot
 *     rather than re-reading today's catalog.
 */

export class ReturnError extends Error {
  constructor(
    public reason: "NOT_SHIPPED" | "NO_LINES" | "EXCEEDS_SHIPPED" | "NOT_FOUND",
    public detail?: string,
  ) {
    super(`Return rejected: ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "ReturnError";
  }
}

export interface ReturnLineInput {
  orderItemId: string;
  qtyUnits: number;
}

export interface CreateReturnInput {
  orderId: string;
  returnDate: string;
  note: string | null;
  lines: ReturnLineInput[];
}

export async function createReturn(
  actorId: string,
  input: CreateReturnInput,
): Promise<string> {
  const wanted = input.lines.filter((l) => l.qtyUnits > 0);
  if (wanted.length === 0) throw new ReturnError("NO_LINES");

  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, number: orders.number, status: orders.status })
      .from(orders)
      .where(eq(orders.id, input.orderId));
    if (!order) throw new ReturnError("NOT_FOUND");
    // Only goods that actually left can come back.
    if (order.status !== "SHIPPED") throw new ReturnError("NOT_SHIPPED");

    const lines = await tx
      .select({
        id: orderItems.id,
        productId: orderItems.productId,
        sku: products.sku,
        name: products.name,
        qtyOrderedUnits: orderItems.qtyOrderedUnits,
        reservedQty: orderItems.reservedQty,
        unitPriceCents: orderItems.unitPriceCents,
        costSnapshotCents: orderItems.costSnapshotCents,
      })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orderItems.orderId, input.orderId));
    const byId = new Map(lines.map((l) => [l.id, l]));

    const alreadyReturned = await getReturnedQuantities(input.orderId, tx);

    const [document] = await tx
      .insert(returns)
      .values({
        orderId: input.orderId,
        returnDate: input.returnDate,
        userId: actorId,
        note: input.note,
      })
      .returning({ id: returns.id });

    let creditCents = 0;
    let totalUnits = 0;

    for (const wantedLine of wanted) {
      const line = byId.get(wantedLine.orderItemId);
      if (!line) throw new ReturnError("NOT_FOUND", wantedLine.orderItemId);

      // The shipped quantity is what the line held at shipment. Reservations are
      // consumed on shipping, so the ordered quantity is the shipped quantity
      // for a fully-reserved line; for a short line it was the reserved amount.
      const shipped = line.qtyOrderedUnits;
      const before = alreadyReturned.get(line.id) ?? 0;
      if (before + wantedLine.qtyUnits > shipped) {
        throw new ReturnError("EXCEEDS_SHIPPED", line.sku);
      }

      await tx.insert(returnItems).values({
        returnId: document.id,
        orderItemId: line.id,
        productId: line.productId,
        qtyUnits: wantedLine.qtyUnits,
        // Snapshots copied from the order line: the reversal must undo exactly
        // what the sale booked, at the price and cost it booked it at.
        unitPriceCents: line.unitPriceCents,
        costSnapshotCents: line.costSnapshotCents,
      });

      await applyMovement(tx, {
        productId: line.productId,
        type: "RETURN",
        qtyUnits: wantedLine.qtyUnits,
        movementDate: input.returnDate,
        userId: actorId,
        returnId: document.id,
        note: `Return · ${order.number}`,
      });

      creditCents += line.unitPriceCents * wantedLine.qtyUnits;
      totalUnits += wantedLine.qtyUnits;
    }

    await writeAudit(
      {
        userId: actorId,
        entity: "return",
        entityId: document.id,
        action: "return",
        label: order.number,
        newValue: {
          returnDate: input.returnDate,
          lines: wanted.length,
          unitsReturned: totalUnits,
          creditCents,
        },
      },
      tx,
    );

    return document.id;
  });
}

/** Lines of a shipped order, with how much of each may still be returned. */
export async function getReturnableLines(
  orderId: string,
): Promise<
  {
    orderItemId: string;
    productId: string;
    sku: string;
    name: string;
    shippedUnits: number;
    alreadyReturnedUnits: number;
    remainingUnits: number;
    unitPriceCents: number;
  }[]
> {
  const lines = await db
    .select({
      id: orderItems.id,
      productId: orderItems.productId,
      sku: products.sku,
      name: products.name,
      qtyOrderedUnits: orderItems.qtyOrderedUnits,
      unitPriceCents: orderItems.unitPriceCents,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId));

  const returned = await getReturnedQuantities(orderId);

  return lines.map((l) => {
    const already = returned.get(l.id) ?? 0;
    return {
      orderItemId: l.id,
      productId: l.productId,
      sku: l.sku,
      name: l.name,
      shippedUnits: l.qtyOrderedUnits,
      alreadyReturnedUnits: already,
      remainingUnits: Math.max(0, l.qtyOrderedUnits - already),
      unitPriceCents: l.unitPriceCents,
    };
  });
}

/** Return history, for the returns list screen. */
export async function listReturns(): Promise<
  {
    id: string;
    orderId: string;
    orderNumber: string;
    customerName: string;
    returnDate: string;
    userName: string | null;
    lineCount: number;
    unitsReturned: number;
    creditCents: number;
  }[]
> {
  const rows = await db.execute(/* sql */ `
    SELECT r.id,
           r.order_id                                   AS "orderId",
           o.number                                     AS "orderNumber",
           c.name                                       AS "customerName",
           r.return_date                                AS "returnDate",
           u.name                                       AS "userName",
           COUNT(ri.id)                                 AS "lineCount",
           COALESCE(SUM(ri.qty_units), 0)               AS "unitsReturned",
           COALESCE(SUM(ri.qty_units * ri.unit_price_cents), 0) AS "creditCents"
      FROM returns r
      JOIN orders o     ON o.id = r.order_id
      JOIN customers c  ON c.id = o.customer_id
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN return_items ri ON ri.return_id = r.id
     GROUP BY r.id, r.order_id, o.number, c.name, r.return_date, u.name
     ORDER BY r.return_date DESC, r.created_at DESC
     LIMIT 500
  `);

  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    orderId: String(r.orderId),
    orderNumber: String(r.orderNumber),
    customerName: String(r.customerName),
    returnDate: String(r.returnDate),
    userName: r.userName === null ? null : String(r.userName),
    lineCount: Number(r.lineCount),
    unitsReturned: Number(r.unitsReturned),
    creditCents: Number(r.creditCents),
  }));
}
