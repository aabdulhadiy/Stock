import { getTableName, sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * A fully-qualified `"table"."column"` reference, for use inside hand-written
 * correlated subqueries.
 *
 * Interpolating a column directly into a `sql` template is NOT safe for this:
 * Drizzle only qualifies column names when the outer query has a join, so
 *
 *     sql`(SELECT SUM(p.amount_cents) FROM payments p WHERE p.order_id = ${orders.id})`
 *
 * renders as `p.order_id = "id"` on a join-free select. Postgres then resolves
 * `"id"` in the *inner* scope — silently comparing `payments.order_id` to
 * `payments.id` and returning 0, or failing outright as ambiguous when the
 * subquery joins two tables that both have an `id`.
 *
 * Both failure modes are invisible in a type check, and one of them is invisible
 * at runtime too, so correlation always goes through this helper.
 */
export function col(column: AnyColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}
