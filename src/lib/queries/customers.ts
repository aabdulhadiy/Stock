import "server-only";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { customers, orders, payments, type Channel, type PriceType } from "@/db/schema";
import { gradeFromDelay, startOfYear, today } from "@/lib/dates";
import type { CustomerGrade } from "@/lib/labels";

/**
 * Customer read models (§8).
 *
 * The §8.2 indicators — debt, average payment delay, grade — are derived, not
 * stored, so they can never drift from the payments that produced them.
 *
 * Payment delay is measured per shipped order as (date the balance was cleared
 * − due date), floored at zero for orders paid early. An unpaid overdue order
 * counts its delay as of today, otherwise a customer who simply never pays
 * would keep a clean grade forever.
 */

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  channel: Channel;
  defaultPriceType: PriceType;
  defaultTermDays: number | null;
  note: string | null;
  active: boolean;
  orderCount: number;
  salesYtdCents: number;
  paidCents: number;
  debtCents: number;
  avgDelayDays: number | null;
  latePaymentCount: number;
  grade: CustomerGrade | null;
}

/**
 * One SQL pass computing, per customer: order count, YTD shipped revenue, total
 * paid, outstanding debt, and the per-order payment delay used for grading.
 */
function customerAggregate(exec: Executor, yearStart: string, now: string) {
  return exec
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      city: customers.city,
      channel: customers.channel,
      defaultPriceType: customers.defaultPriceType,
      defaultTermDays: customers.defaultTermDays,
      note: customers.note,
      active: customers.active,

      orderCount: sql<number>`(
        SELECT COUNT(*) FROM orders o
         WHERE o.customer_id = ${customers.id} AND o.status <> 'CANCELLED'
      )`,

      // Revenue counts shipped orders only — an order that never shipped is
      // not a sale (§10.3).
      salesYtdCents: sql<number>`COALESCE((
        SELECT SUM(o.total_cents) FROM orders o
         WHERE o.customer_id = ${customers.id}
           AND o.status = 'SHIPPED'
           AND o.actual_ship_date >= ${yearStart}
      ), 0)`,

      paidCents: sql<number>`COALESCE((
        SELECT SUM(p.amount_cents) FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE o.customer_id = ${customers.id}
      ), 0)`,

      debtCents: sql<number>`COALESCE((
        SELECT SUM(o.total_cents - COALESCE((
                 SELECT SUM(p.amount_cents) FROM payments p WHERE p.order_id = o.id
               ), 0))
          FROM orders o
         WHERE o.customer_id = ${customers.id}
           AND o.status = 'SHIPPED'
           AND o.total_cents > COALESCE((
                 SELECT SUM(p.amount_cents) FROM payments p WHERE p.order_id = o.id
               ), 0)
      ), 0)`,

      // Average delay in days across shipped orders with a due date. A settled
      // order uses its last payment date; an unsettled one uses today.
      avgDelayDays: sql<number | null>`(
        SELECT AVG(GREATEST(0, d.delay))::float FROM (
          SELECT (
            CASE
              WHEN o.total_cents <= COALESCE((
                     SELECT SUM(p.amount_cents) FROM payments p WHERE p.order_id = o.id
                   ), 0)
              THEN COALESCE((
                     SELECT MAX(p.paid_on) FROM payments p WHERE p.order_id = o.id
                   ), o.due_date) - o.due_date
              ELSE ${now}::date - o.due_date
            END
          ) AS delay
          FROM orders o
          WHERE o.customer_id = ${customers.id}
            AND o.status = 'SHIPPED'
            AND o.due_date IS NOT NULL
        ) d
      )`,

      latePaymentCount: sql<number>`COALESCE((
        SELECT COUNT(*) FROM orders o
         WHERE o.customer_id = ${customers.id}
           AND o.status = 'SHIPPED'
           AND o.due_date IS NOT NULL
           AND (
             CASE
               WHEN o.total_cents <= COALESCE((
                      SELECT SUM(p.amount_cents) FROM payments p WHERE p.order_id = o.id
                    ), 0)
               THEN COALESCE((
                      SELECT MAX(p.paid_on) FROM payments p WHERE p.order_id = o.id
                    ), o.due_date) > o.due_date
               ELSE ${now}::date > o.due_date
             END
           )
      ), 0)`,
    })
    .from(customers);
}

function buildCustomerRow(r: Awaited<ReturnType<typeof customerAggregate>>[number]): CustomerRow {
  const avgDelay = r.avgDelayDays === null ? null : Number(r.avgDelayDays);
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    city: r.city,
    channel: r.channel,
    defaultPriceType: r.defaultPriceType,
    defaultTermDays: r.defaultTermDays,
    note: r.note,
    active: r.active,
    orderCount: Number(r.orderCount),
    salesYtdCents: Number(r.salesYtdCents),
    paidCents: Number(r.paidCents),
    debtCents: Number(r.debtCents),
    avgDelayDays: avgDelay === null ? null : Math.round(avgDelay * 10) / 10,
    latePaymentCount: Number(r.latePaymentCount),
    grade: gradeFromDelay(avgDelay),
  };
}

export async function listCustomers(
  options: {
    search?: string;
    channel?: Channel | "ALL";
    onlyWithDebt?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
  exec: Executor = db,
): Promise<{ rows: CustomerRow[]; total: number; page: number; pageCount: number }> {
  const { search, channel = "ALL", onlyWithDebt = false, page = 1, pageSize = 50 } = options;
  const now = today();
  const yearStart = startOfYear(now);

  const conditions = [];
  if (channel !== "ALL") conditions.push(eq(customers.channel, channel));
  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    conditions.push(or(ilike(customers.name, term), ilike(customers.phone, term)));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [countRow] = await exec.select({ n: count() }).from(customers).where(where);

  const rows = (
    await customerAggregate(exec, yearStart, now)
      .where(where)
      .orderBy(asc(customers.name))
      .limit(pageSize)
      .offset(Math.max(0, (page - 1) * pageSize))
  ).map(buildCustomerRow);

  const filtered = onlyWithDebt ? rows.filter((r) => r.debtCents > 0) : rows;
  const total = onlyWithDebt ? filtered.length : Number(countRow?.n ?? 0);

  return {
    rows: filtered,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCustomer(
  id: string,
  exec: Executor = db,
): Promise<CustomerRow | null> {
  const now = today();
  const [row] = await customerAggregate(exec, startOfYear(now), now).where(
    eq(customers.id, id),
  );
  return row ? buildCustomerRow(row) : null;
}

/** Order history for the customer page (§8.2). */
export async function getCustomerOrders(
  customerId: string,
  exec: Executor = db,
): Promise<
  {
    id: string;
    number: string;
    status: string;
    createdAt: Date;
    actualShipDate: string | null;
    dueDate: string | null;
    totalCents: number;
    paidCents: number;
    balanceCents: number;
  }[]
> {
  const rows = await exec
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      createdAt: orders.createdAt,
      actualShipDate: orders.actualShipDate,
      dueDate: orders.dueDate,
      totalCents: orders.totalCents,
      paidCents: sql<number>`COALESCE((
        SELECT SUM(p.amount_cents) FROM payments p WHERE p.order_id = ${orders.id}
      ), 0)`,
    })
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.createdAt));

  return rows.map((r) => ({
    ...r,
    totalCents: Number(r.totalCents),
    paidCents: Number(r.paidCents),
    balanceCents: Number(r.totalCents) - Number(r.paidCents),
  }));
}

/** Lightweight picker options for the order form. */
export async function listCustomerOptions(
  exec: Executor = db,
): Promise<
  {
    id: string;
    name: string;
    phone: string;
    channel: Channel;
    defaultPriceType: PriceType;
    defaultTermDays: number | null;
  }[]
> {
  return exec
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      channel: customers.channel,
      defaultPriceType: customers.defaultPriceType,
      defaultTermDays: customers.defaultTermDays,
    })
    .from(customers)
    .where(eq(customers.active, true))
    .orderBy(asc(customers.name));
}

/** Total payments recorded against a single order. */
export async function getOrderPaidCents(
  orderId: string,
  exec: Executor = db,
): Promise<number> {
  const [row] = await exec
    .select({ paid: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)` })
    .from(payments)
    .where(eq(payments.orderId, orderId));
  return Number(row?.paid ?? 0);
}
