import "server-only";
import { and, asc, count, desc, eq, gte, inArray, lte, or, ilike, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  customers,
  orderItems,
  orders,
  payments,
  productStock,
  products,
  users,
  type OrderStatus,
  type Role,
} from "@/db/schema";
import {
  toOrderLineView,
  toOrderTotal,
  type OrderLineView,
} from "@/lib/dto";
import { availabilityOf, type Availability } from "@/lib/labels";
import { daysBetween, today } from "@/lib/dates";
import { pickingSummary, type PickingSummary } from "@/lib/orders";
import { getOrderBalance } from "@/lib/payments";
import { unitsToBoxes } from "@/lib/validation";
import { col } from "@/lib/sql";

/**
 * Order read models (§5, §7), role-scoped.
 *
 * Prices are attached by `lib/dto.ts`, so a warehouseman's order payload has no
 * price fields at all — which is what makes the §7.5 "the warehouse version
 * contains no prices" rule structural rather than a template detail.
 */

export interface OrderListRow {
  id: string;
  number: string;
  status: OrderStatus;
  customerId: string;
  customerName: string;
  /**
   * Which of the two sale prices the order uses. Absent for the warehouseman:
   * §2.2 gives them no access to Market or Export prices, and the price *type*
   * names them directly.
   */
  priceType?: "MARKET" | "EXPORT";
  createdAt: Date;
  plannedShipDate: string;
  actualShipDate: string | null;
  dueDate: string | null;
  lineCount: number;
  totalUnits: number;
  reservedUnits: number;
  shortfallUnits: number;
  createdByName: string | null;
  /** Present only for roles allowed to see sale prices. */
  totalCents?: number;
  paidCents?: number;
  returnedCents?: number;
  balanceCents?: number;
  /** Days late shipping: positive is late, negative early, null if unshipped. */
  shipDelayDays: number | null;
  /** Days past the payment due date; null when not applicable. */
  overdueDays: number | null;
}

export interface OrderListOptions {
  search?: string;
  status?: OrderStatus | "ALL" | "OPEN";
  customerId?: string | null;
  from?: string;
  to?: string;
  /** Restrict to orders created by this user (salesperson scoping). */
  createdById?: string;
  onlyOverdue?: boolean;
  onlyLate?: boolean;
  page?: number;
  pageSize?: number;
}

/** Statuses that are still in flight. */
export const OPEN_STATUSES: OrderStatus[] = ["NEW", "PICKING", "READY"];

export async function listOrders(
  role: Role,
  options: OrderListOptions = {},
  exec: Executor = db,
): Promise<{ rows: OrderListRow[]; total: number; page: number; pageCount: number }> {
  const {
    search,
    status = "ALL",
    customerId,
    from,
    to,
    createdById,
    onlyOverdue = false,
    onlyLate = false,
    page = 1,
    pageSize = 50,
  } = options;

  const now = today();
  const conditions = [];

  if (status === "OPEN") conditions.push(inArray(orders.status, OPEN_STATUSES));
  else if (status !== "ALL") conditions.push(eq(orders.status, status));

  if (customerId) conditions.push(eq(orders.customerId, customerId));
  if (createdById) conditions.push(eq(orders.createdById, createdById));
  if (from) conditions.push(gte(sql`${orders.createdAt}::date`, from));
  if (to) conditions.push(lte(sql`${orders.createdAt}::date`, to));
  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    conditions.push(or(ilike(orders.number, term), ilike(customers.name, term)));
  }
  if (onlyOverdue) {
    conditions.push(
      and(
        eq(orders.status, "SHIPPED"),
        sql`${orders.dueDate} IS NOT NULL AND ${orders.dueDate} < ${now}`,
        sql`${orders.totalCents} > COALESCE((
          SELECT SUM(p.amount_cents) FROM payments p WHERE p.order_id = ${col(orders.id)}
        ), 0) + COALESCE((
          SELECT SUM(ri.qty_units * ri.unit_price_cents)
            FROM return_items ri JOIN returns rt ON rt.id = ri.return_id
           WHERE rt.order_id = ${col(orders.id)}
        ), 0)`,
      ),
    );
  }
  if (onlyLate) {
    conditions.push(
      sql`${orders.actualShipDate} IS NOT NULL
          AND ${orders.actualShipDate} > ${orders.plannedShipDate}`,
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const [countRow] = await exec
    .select({ n: count() })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(where);
  const total = Number(countRow?.n ?? 0);

  const rows = await exec
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      customerId: orders.customerId,
      customerName: customers.name,
      priceType: orders.priceType,
      createdAt: orders.createdAt,
      plannedShipDate: orders.plannedShipDate,
      actualShipDate: orders.actualShipDate,
      dueDate: orders.dueDate,
      totalCents: orders.totalCents,
      createdByName: users.name,
      lineCount: sql<number>`(
        SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = ${col(orders.id)}
      )`,
      totalUnits: sql<number>`COALESCE((
        SELECT SUM(oi.qty_ordered_units) FROM order_items oi WHERE oi.order_id = ${col(orders.id)}
      ), 0)`,
      reservedUnits: sql<number>`COALESCE((
        SELECT SUM(oi.reserved_qty) FROM order_items oi WHERE oi.order_id = ${col(orders.id)}
      ), 0)`,
      paidCents: sql<number>`COALESCE((
        SELECT SUM(p.amount_cents) FROM payments p WHERE p.order_id = ${col(orders.id)}
      ), 0)`,
      // §11: returned goods credit the balance, so they belong in it.
      returnedCents: sql<number>`COALESCE((
        SELECT SUM(ri.qty_units * ri.unit_price_cents)
          FROM return_items ri JOIN returns rt ON rt.id = ri.return_id
         WHERE rt.order_id = ${col(orders.id)}
      ), 0)`,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(users, eq(users.id, orders.createdById))
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(pageSize)
    .offset(Math.max(0, (page - 1) * pageSize));

  const showMoney = role === "DIRECTOR" || role === "SALESPERSON";

  return {
    rows: rows.map((r) => {
      const totalUnits = Number(r.totalUnits);
      const reservedUnits = Number(r.reservedUnits);
      const paid = Number(r.paidCents);
      const returned = Number(r.returnedCents);
      const settledCents = paid + returned;

      const row: OrderListRow = {
        id: r.id,
        number: r.number,
        status: r.status,
        customerId: r.customerId,
        customerName: r.customerName,
        createdAt: r.createdAt,
        plannedShipDate: r.plannedShipDate,
        actualShipDate: r.actualShipDate,
        dueDate: r.dueDate,
        lineCount: Number(r.lineCount),
        totalUnits,
        reservedUnits,
        shortfallUnits: Math.max(0, totalUnits - reservedUnits),
        createdByName: r.createdByName,
        shipDelayDays: r.actualShipDate
          ? daysBetween(r.plannedShipDate, r.actualShipDate)
          : null,
        overdueDays:
          r.status === "SHIPPED" && r.dueDate && r.totalCents > settledCents
            ? Math.max(0, daysBetween(r.dueDate, now) ?? 0)
            : null,
      };

      if (showMoney) {
        row.priceType = r.priceType;
        row.totalCents = r.totalCents;
        row.paidCents = paid;
        row.returnedCents = returned;
        row.balanceCents = r.totalCents - settledCents;
      }
      return row;
    }),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface OrderDetailLine extends OrderLineView {
  /** §7.1 colour, computed against availability at this moment. */
  availability: Availability;
  boxes: number;
}

export interface OrderDetail {
  id: string;
  number: string;
  status: OrderStatus;
  /** Absent for the warehouseman — see the note on OrderListRow.priceType. */
  priceType?: "MARKET" | "EXPORT";
  createdAt: Date;
  createdById: string | null;
  createdByName: string | null;
  acceptedByName: string | null;
  acceptedAt: Date | null;
  plannedShipDate: string;
  actualShipDate: string | null;
  dueDate: string | null;
  paymentMethod: "CASH" | "BANK";
  paymentTermDays: number;
  note: string | null;
  customer: {
    id: string;
    name: string;
    phone: string;
    city: string | null;
    channel: string;
  };
  lines: OrderDetailLine[];
  summary: PickingSummary;
  fullyReserved: boolean;
  allPicked: boolean;
  shipDelayDays: number | null;
  /** Money, present only for roles allowed to see sale prices. */
  totalCents?: number;
  paidCents?: number;
  returnedCents?: number;
  balanceCents?: number;
  payments?: {
    id: string;
    paidOn: string;
    amountCents: number;
    method: "CASH" | "BANK";
    note: string | null;
    userName: string | null;
  }[];
}

export async function getOrderDetail(
  orderId: string,
  role: Role,
  exec: Executor = db,
): Promise<OrderDetail | null> {
  const [order] = await exec
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      priceType: orders.priceType,
      createdAt: orders.createdAt,
      createdById: orders.createdById,
      plannedShipDate: orders.plannedShipDate,
      actualShipDate: orders.actualShipDate,
      dueDate: orders.dueDate,
      paymentMethod: orders.paymentMethod,
      paymentTermDays: orders.paymentTermDays,
      note: orders.note,
      totalCents: orders.totalCents,
      acceptedAt: orders.acceptedAt,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerCity: customers.city,
      customerChannel: customers.channel,
      createdByName: sql<string | null>`(
        SELECT u.name FROM users u WHERE u.id = ${col(orders.createdById)}
      )`,
      acceptedByName: sql<string | null>`(
        SELECT u.name FROM users u WHERE u.id = ${col(orders.acceptedById)}
      )`,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, orderId));

  if (!order) return null;

  const lineRows = await exec
    .select({
      id: orderItems.id,
      productId: orderItems.productId,
      sku: products.sku,
      name: products.name,
      unitsPerBox: products.unitsPerBox,
      unitsPerBag: products.unitsPerBag,
      weightKg: products.weightKg,
      weightBasis: products.weightBasis,
      boxVolumeM3: products.boxVolumeM3,
      bagVolumeM3: products.bagVolumeM3,
      qtyOrderedUnits: orderItems.qtyOrderedUnits,
      enteredAs: orderItems.enteredAs,
      enteredQty: orderItems.enteredQty,
      reservedQty: orderItems.reservedQty,
      picked: orderItems.picked,
      unitPriceCents: orderItems.unitPriceCents,
      basePriceSnapshotCents: orderItems.basePriceSnapshotCents,
      onHand: sql<number>`COALESCE(${productStock.onHand}, 0)`,
      reservedTotal: sql<number>`COALESCE(${productStock.reserved}, 0)`,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .leftJoin(productStock, eq(productStock.productId, orderItems.productId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(products.name));

  const lines: OrderDetailLine[] = lineRows.map((r) => {
    // Availability for *this* line: what is free, plus what this line already
    // holds — otherwise a fully reserved line would read as "unavailable".
    const freeNow = Number(r.onHand) - Number(r.reservedTotal);
    const availableForLine = freeNow + r.reservedQty;
    const shortfall = Math.max(0, r.qtyOrderedUnits - r.reservedQty);

    const base = toOrderLineView(
      {
        id: r.id,
        productId: r.productId,
        sku: r.sku,
        name: r.name,
        unitsPerBox: r.unitsPerBox,
        qtyOrderedUnits: r.qtyOrderedUnits,
        enteredAs: r.enteredAs,
        enteredQty: r.enteredQty,
        reservedQty: r.reservedQty,
        shortfall,
        picked: r.picked,
        availableNow: freeNow,
        unitPriceCents: r.unitPriceCents,
        basePriceSnapshotCents: r.basePriceSnapshotCents,
        lineTotalCents: r.unitPriceCents * r.qtyOrderedUnits,
      },
      role,
    );

    return {
      ...base,
      availability:
        order.status === "NEW"
          ? availabilityOf(r.qtyOrderedUnits, freeNow)
          : availabilityOf(r.qtyOrderedUnits, availableForLine),
      boxes: unitsToBoxes(r.qtyOrderedUnits, r.unitsPerBox),
    };
  });

  const summary = pickingSummary(
    lineRows.map((r) => ({
      productId: r.productId,
      qtyUnits: r.qtyOrderedUnits,
      unitsPerBox: r.unitsPerBox,
      unitsPerBag: r.unitsPerBag,
      weightKg: r.weightKg,
      weightBasis: r.weightBasis,
      boxVolumeM3: r.boxVolumeM3,
      bagVolumeM3: r.bagVolumeM3,
      enteredAs: r.enteredAs,
    })),
  );

  const detail: OrderDetail = {
    id: order.id,
    number: order.number,
    status: order.status,
    createdAt: order.createdAt,
    createdById: order.createdById,
    createdByName: order.createdByName,
    acceptedByName: order.acceptedByName,
    acceptedAt: order.acceptedAt,
    plannedShipDate: order.plannedShipDate,
    actualShipDate: order.actualShipDate,
    dueDate: order.dueDate,
    paymentMethod: order.paymentMethod,
    paymentTermDays: order.paymentTermDays,
    note: order.note,
    customer: {
      id: order.customerId,
      name: order.customerName,
      phone: order.customerPhone,
      city: order.customerCity,
      channel: order.customerChannel,
    },
    lines,
    summary,
    fullyReserved:
      lineRows.length > 0 && lineRows.every((l) => l.reservedQty >= l.qtyOrderedUnits),
    allPicked: lineRows.length > 0 && lineRows.every((l) => l.picked),
    shipDelayDays: order.actualShipDate
      ? daysBetween(order.plannedShipDate, order.actualShipDate)
      : null,
  };

  if (role === "DIRECTOR" || role === "SALESPERSON") {
    detail.priceType = order.priceType;
    const paymentRows = await exec
      .select({
        id: payments.id,
        paidOn: payments.paidOn,
        amountCents: payments.amountCents,
        method: payments.method,
        note: payments.note,
        userName: users.name,
      })
      .from(payments)
      .leftJoin(users, eq(users.id, payments.userId))
      .where(eq(payments.orderId, orderId))
      .orderBy(desc(payments.paidOn));

    const paid = paymentRows.reduce((s, p) => s + Number(p.amountCents), 0);
    const balance = await getOrderBalance(orderId, exec);
    detail.totalCents = toOrderTotal(order.totalCents, role);
    detail.paidCents = paid;
    detail.returnedCents = balance?.returnedCents ?? 0;
    detail.balanceCents = balance?.balanceCents ?? order.totalCents - paid;
    detail.payments = paymentRows.map((p) => ({ ...p, amountCents: Number(p.amountCents) }));
  }

  return detail;
}

/** The warehouseman's queue: orders awaiting acceptance, oldest first (BR-4). */
export async function listQueue(
  role: Role,
  exec: Executor = db,
): Promise<OrderListRow[]> {
  const { rows } = await listOrders(
    role,
    { status: "NEW", pageSize: 200 },
    exec,
  );
  // §7.1: first come, first served — the queue is ordered by creation.
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Orders currently being picked or ready to ship. */
export async function listInProgress(
  role: Role,
  exec: Executor = db,
): Promise<OrderListRow[]> {
  const [picking, ready] = await Promise.all([
    listOrders(role, { status: "PICKING", pageSize: 200 }, exec),
    listOrders(role, { status: "READY", pageSize: 200 }, exec),
  ]);
  return [...picking.rows, ...ready.rows];
}

/** Shipped orders available to return against (§11). */
export async function listShippedOrders(exec: Executor = db) {
  return exec
    .select({
      id: orders.id,
      number: orders.number,
      customerName: customers.name,
      actualShipDate: orders.actualShipDate,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.status, "SHIPPED"))
    .orderBy(desc(orders.actualShipDate))
    .limit(500);
}

/** Counts per status, for the dashboard tile row (§10.1). */
export async function countOrdersByStatus(
  exec: Executor = db,
): Promise<Record<OrderStatus, number>> {
  const rows = await exec
    .select({ status: orders.status, n: count() })
    .from(orders)
    .groupBy(orders.status);

  const out: Record<OrderStatus, number> = {
    NEW: 0,
    PICKING: 0,
    READY: 0,
    SHIPPED: 0,
    CANCELLED: 0,
  };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}
