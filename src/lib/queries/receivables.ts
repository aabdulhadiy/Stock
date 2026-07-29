import "server-only";
import { sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { agingBucket, daysBetween, today, type AgingBucket } from "@/lib/dates";

/**
 * Receivables with aging buckets (§10.3 report 7).
 *
 * "Outstanding" means a shipped order whose total exceeds payments received
 * plus credit for returned goods. The bucket is chosen from how far past the due
 * date it is, so an order due tomorrow sits in "current" and one due yesterday
 * is already in 1–7 days — which is the day+1 overdue detection §17 asks for.
 */

export interface ReceivableRow {
  orderId: string;
  number: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  actualShipDate: string | null;
  dueDate: string | null;
  totalCents: number;
  paidCents: number;
  returnedCents: number;
  balanceCents: number;
  overdueDays: number;
  bucket: AgingBucket;
}

export interface ReceivablesSummary {
  rows: ReceivableRow[];
  totalOutstandingCents: number;
  byBucket: Record<AgingBucket, { count: number; amountCents: number }>;
}

export async function getReceivables(
  options: { onlyOverdue?: boolean; customerId?: string } = {},
  exec: Executor = db,
): Promise<ReceivablesSummary> {
  const now = today();

  const rows = await exec.execute(sql`
    SELECT o.id                                     AS order_id,
           o.number                                 AS number,
           c.id                                     AS customer_id,
           c.name                                   AS customer_name,
           c.phone                                  AS customer_phone,
           o.actual_ship_date                       AS actual_ship_date,
           o.due_date                               AS due_date,
           o.total_cents                            AS total_cents,
           COALESCE(pay.paid, 0)                    AS paid_cents,
           COALESCE(ret.credited, 0)                AS returned_cents
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN (
        SELECT order_id, SUM(amount_cents) AS paid FROM payments GROUP BY order_id
      ) pay ON pay.order_id = o.id
      LEFT JOIN (
        SELECT r.order_id, SUM(ri.qty_units * ri.unit_price_cents) AS credited
          FROM return_items ri JOIN returns r ON r.id = ri.return_id
         GROUP BY r.order_id
      ) ret ON ret.order_id = o.id
     WHERE o.status = 'SHIPPED'
       AND o.total_cents > COALESCE(pay.paid, 0) + COALESCE(ret.credited, 0)
       ${options.customerId ? sql`AND c.id = ${options.customerId}` : sql``}
     ORDER BY o.due_date NULLS LAST, o.number
  `);

  const mapped: ReceivableRow[] = (
    rows as unknown as Record<string, unknown>[]
  ).map((r) => {
    const total = Number(r.total_cents);
    const paid = Number(r.paid_cents);
    const returned = Number(r.returned_cents);
    const dueDate = r.due_date === null ? null : String(r.due_date);
    const overdue = dueDate ? Math.max(0, daysBetween(dueDate, now) ?? 0) : 0;

    return {
      orderId: String(r.order_id),
      number: String(r.number),
      customerId: String(r.customer_id),
      customerName: String(r.customer_name),
      customerPhone: String(r.customer_phone),
      actualShipDate: r.actual_ship_date === null ? null : String(r.actual_ship_date),
      dueDate,
      totalCents: total,
      paidCents: paid,
      returnedCents: returned,
      balanceCents: total - paid - returned,
      overdueDays: overdue,
      bucket: agingBucket(dueDate, now),
    };
  });

  const filtered = options.onlyOverdue ? mapped.filter((r) => r.overdueDays > 0) : mapped;

  const byBucket: Record<AgingBucket, { count: number; amountCents: number }> = {
    CURRENT: { count: 0, amountCents: 0 },
    D1_7: { count: 0, amountCents: 0 },
    D8_30: { count: 0, amountCents: 0 },
    D30_PLUS: { count: 0, amountCents: 0 },
  };
  for (const row of filtered) {
    byBucket[row.bucket].count++;
    byBucket[row.bucket].amountCents += row.balanceCents;
  }

  return {
    rows: filtered,
    totalOutstandingCents: filtered.reduce((s, r) => s + r.balanceCents, 0),
    byBucket,
  };
}

/** Dashboard tile figures (§10.1). */
export async function getReceivablesTotals(
  exec: Executor = db,
): Promise<{ outstandingCents: number; overdueCents: number; overdueCount: number }> {
  const { rows } = await getReceivables({}, exec);
  const overdue = rows.filter((r) => r.overdueDays > 0);
  return {
    outstandingCents: rows.reduce((s, r) => s + r.balanceCents, 0),
    overdueCents: overdue.reduce((s, r) => s + r.balanceCents, 0),
    overdueCount: overdue.length,
  };
}
