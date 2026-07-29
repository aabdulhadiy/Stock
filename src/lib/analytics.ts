import "server-only";
import { sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { breakEvenRevenueCents, marginRatio } from "@/lib/money";
import {
  endOfMonth,
  monthKey,
  monthRange,
  startOfMonth,
  today,
  type Period,
} from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { movementStatusFor, type CustomerGrade } from "@/lib/labels";
import { daysSince } from "@/lib/dates";
import type { MovementStatus } from "@/lib/dto";

/**
 * Analytics (§4.3, §4.4, §9.4, §10).
 *
 * The formulas are Appendix A's, and two attribution rules make them
 * unambiguous:
 *
 *  - A sale belongs to the period it **shipped** in (`actual_ship_date`), not
 *    the period it was ordered in. An order created in June and shipped in July
 *    is July revenue.
 *  - A return belongs to the period it **came back** in (`return_date`), and
 *    reverses revenue and COGS at the snapshots the sale booked — so reversing a
 *    June sale in July reduces July, and June's signed-off figures stay put.
 *
 * All money is integer cents, so every total here is exact.
 */

// ---------------------------------------------------------------------------
// Sales and profit
// ---------------------------------------------------------------------------

export interface SalesTotals {
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  /** Gross margin as a fraction of revenue, or null when there is no revenue. */
  grossMargin: number | null;
  unitsSold: number;
  orderCount: number;
  returnedRevenueCents: number;
  returnedCogsCents: number;
  returnedUnits: number;
}

/** Gross revenue, COGS and profit for shipped orders in a period, net of returns. */
export async function getSalesTotals(
  period: Period,
  exec: Executor = db,
): Promise<SalesTotals> {
  const [sold] = (await exec.execute(sql`
    SELECT COALESCE(SUM(oi.unit_price_cents * oi.qty_ordered_units), 0)  AS revenue,
           COALESCE(SUM(COALESCE(oi.cost_snapshot_cents, 0) * oi.qty_ordered_units), 0) AS cogs,
           COALESCE(SUM(oi.qty_ordered_units), 0)                        AS units,
           COUNT(DISTINCT o.id)                                          AS orders
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
     WHERE o.status = 'SHIPPED'
       AND o.actual_ship_date BETWEEN ${period.from} AND ${period.to}
  `)) as unknown as { revenue: string; cogs: string; units: string; orders: string }[];

  const [returned] = (await exec.execute(sql`
    SELECT COALESCE(SUM(ri.unit_price_cents * ri.qty_units), 0)          AS revenue,
           COALESCE(SUM(COALESCE(ri.cost_snapshot_cents, 0) * ri.qty_units), 0) AS cogs,
           COALESCE(SUM(ri.qty_units), 0)                                AS units
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
     WHERE r.return_date BETWEEN ${period.from} AND ${period.to}
  `)) as unknown as { revenue: string; cogs: string; units: string }[];

  const revenue = Number(sold?.revenue ?? 0) - Number(returned?.revenue ?? 0);
  const cogs = Number(sold?.cogs ?? 0) - Number(returned?.cogs ?? 0);
  const gross = revenue - cogs;

  return {
    revenueCents: revenue,
    cogsCents: cogs,
    grossProfitCents: gross,
    grossMargin: marginRatio(revenue, gross),
    unitsSold: Number(sold?.units ?? 0) - Number(returned?.units ?? 0),
    orderCount: Number(sold?.orders ?? 0),
    returnedRevenueCents: Number(returned?.revenue ?? 0),
    returnedCogsCents: Number(returned?.cogs ?? 0),
    returnedUnits: Number(returned?.units ?? 0),
  };
}

export type SalesDimension = "day" | "month" | "year" | "channel" | "customer" | "product";

export interface SalesBreakdownRow {
  key: string;
  label: string;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  grossMargin: number | null;
  unitsSold: number;
  orderCount: number;
}

/**
 * §10.3 report 1 & 2: sales and profit grouped by a dimension.
 *
 * Returns are netted off inside the same grouping, so a product's profit line
 * already accounts for what came back.
 */
export async function getSalesBreakdown(
  period: Period,
  dimension: SalesDimension,
  exec: Executor = db,
): Promise<SalesBreakdownRow[]> {
  // Each dimension needs its own key/label expression on both the sales side
  // and the returns side, so the two can be merged by key.
  const spec: Record<
    SalesDimension,
    { soldKey: string; soldLabel: string; retKey: string; retLabel: string }
  > = {
    day: {
      soldKey: "o.actual_ship_date::text",
      soldLabel: "o.actual_ship_date::text",
      retKey: "r.return_date::text",
      retLabel: "r.return_date::text",
    },
    month: {
      soldKey: "to_char(o.actual_ship_date, 'YYYY-MM')",
      soldLabel: "to_char(o.actual_ship_date, 'YYYY-MM')",
      retKey: "to_char(r.return_date, 'YYYY-MM')",
      retLabel: "to_char(r.return_date, 'YYYY-MM')",
    },
    year: {
      soldKey: "to_char(o.actual_ship_date, 'YYYY')",
      soldLabel: "to_char(o.actual_ship_date, 'YYYY')",
      retKey: "to_char(r.return_date, 'YYYY')",
      retLabel: "to_char(r.return_date, 'YYYY')",
    },
    channel: {
      soldKey: "c.channel::text",
      soldLabel: "c.channel::text",
      retKey: "c.channel::text",
      retLabel: "c.channel::text",
    },
    customer: {
      soldKey: "c.id::text",
      soldLabel: "c.name",
      retKey: "c.id::text",
      retLabel: "c.name",
    },
    product: {
      soldKey: "p.id::text",
      soldLabel: "(p.sku || ' — ' || p.name)",
      retKey: "p.id::text",
      retLabel: "(p.sku || ' — ' || p.name)",
    },
  };
  const s = spec[dimension];

  const soldRows = (await exec.execute(
    sql`
      SELECT ${sql.raw(s.soldKey)}   AS key,
             MIN(${sql.raw(s.soldLabel)}) AS label,
             COALESCE(SUM(oi.unit_price_cents * oi.qty_ordered_units), 0) AS revenue,
             COALESCE(SUM(COALESCE(oi.cost_snapshot_cents, 0) * oi.qty_ordered_units), 0) AS cogs,
             COALESCE(SUM(oi.qty_ordered_units), 0) AS units,
             COUNT(DISTINCT o.id) AS orders
        FROM order_items oi
        JOIN orders o     ON o.id = oi.order_id
        JOIN customers c  ON c.id = o.customer_id
        JOIN products p   ON p.id = oi.product_id
       WHERE o.status = 'SHIPPED'
         AND o.actual_ship_date BETWEEN ${period.from} AND ${period.to}
       GROUP BY ${sql.raw(s.soldKey)}
    `,
  )) as unknown as Record<string, unknown>[];

  const returnRows = (await exec.execute(
    sql`
      SELECT ${sql.raw(s.retKey)}    AS key,
             MIN(${sql.raw(s.retLabel)}) AS label,
             COALESCE(SUM(ri.unit_price_cents * ri.qty_units), 0) AS revenue,
             COALESCE(SUM(COALESCE(ri.cost_snapshot_cents, 0) * ri.qty_units), 0) AS cogs,
             COALESCE(SUM(ri.qty_units), 0) AS units
        FROM return_items ri
        JOIN returns r    ON r.id = ri.return_id
        JOIN orders o     ON o.id = r.order_id
        JOIN customers c  ON c.id = o.customer_id
        JOIN products p   ON p.id = ri.product_id
       WHERE r.return_date BETWEEN ${period.from} AND ${period.to}
       GROUP BY ${sql.raw(s.retKey)}
    `,
  )) as unknown as Record<string, unknown>[];

  const merged = new Map<string, SalesBreakdownRow>();

  for (const row of soldRows) {
    const key = String(row.key);
    merged.set(key, {
      key,
      label: String(row.label ?? key),
      revenueCents: Number(row.revenue),
      cogsCents: Number(row.cogs),
      grossProfitCents: Number(row.revenue) - Number(row.cogs),
      grossMargin: marginRatio(Number(row.revenue), Number(row.revenue) - Number(row.cogs)),
      unitsSold: Number(row.units),
      orderCount: Number(row.orders),
    });
  }

  for (const row of returnRows) {
    const key = String(row.key);
    const existing = merged.get(key) ?? {
      key,
      label: String(row.label ?? key),
      revenueCents: 0,
      cogsCents: 0,
      grossProfitCents: 0,
      grossMargin: null,
      unitsSold: 0,
      orderCount: 0,
    };
    existing.revenueCents -= Number(row.revenue);
    existing.cogsCents -= Number(row.cogs);
    existing.unitsSold -= Number(row.units);
    existing.grossProfitCents = existing.revenueCents - existing.cogsCents;
    existing.grossMargin = marginRatio(existing.revenueCents, existing.grossProfitCents);
    merged.set(key, existing);
  }

  const rows = [...merged.values()];
  // Time dimensions read chronologically; everything else by size.
  return dimension === "day" || dimension === "month" || dimension === "year"
    ? rows.sort((a, b) => a.key.localeCompare(b.key))
    : rows.sort((a, b) => b.revenueCents - a.revenueCents);
}

// ---------------------------------------------------------------------------
// Expenses (§9)
// ---------------------------------------------------------------------------

export interface ExpenseTotals {
  totalCents: number;
  fixedCents: number;
  variableCents: number;
  byCategory: {
    categoryId: string;
    name: string;
    type: "FIXED" | "VARIABLE";
    amountCents: number;
  }[];
}

export async function getExpenseTotals(
  period: Period,
  exec: Executor = db,
): Promise<ExpenseTotals> {
  const rows = (await exec.execute(sql`
    SELECT ec.id                          AS category_id,
           ec.name                        AS name,
           ec.type::text                  AS type,
           COALESCE(SUM(e.amount_cents), 0) AS amount
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e.category_id
     WHERE e.expense_date BETWEEN ${period.from} AND ${period.to}
     GROUP BY ec.id, ec.name, ec.type
     ORDER BY amount DESC
  `)) as unknown as Record<string, unknown>[];

  const byCategory = rows.map((r) => ({
    categoryId: String(r.category_id),
    name: String(r.name),
    type: String(r.type) as "FIXED" | "VARIABLE",
    amountCents: Number(r.amount),
  }));

  return {
    totalCents: byCategory.reduce((s, c) => s + c.amountCents, 0),
    fixedCents: byCategory
      .filter((c) => c.type === "FIXED")
      .reduce((s, c) => s + c.amountCents, 0),
    variableCents: byCategory
      .filter((c) => c.type === "VARIABLE")
      .reduce((s, c) => s + c.amountCents, 0),
    byCategory,
  };
}

// ---------------------------------------------------------------------------
// P&L and break-even (§9.4, §10.1)
// ---------------------------------------------------------------------------

export interface ProfitAndLoss {
  period: Period;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  grossMargin: number | null;
  operatingExpensesCents: number;
  fixedExpensesCents: number;
  variableExpensesCents: number;
  operatingProfitCents: number;
  /** Operating expenses as a fraction of revenue (§9.4). */
  expenseRatio: number | null;
  /** Revenue needed to cover fixed costs; null when the margin is unusable. */
  breakEvenRevenueCents: number | null;
  /** Progress toward break-even, 0..1+; null when break-even is unknown. */
  breakEvenProgress: number | null;
}

/**
 * Revenue − COGS = Gross profit − Operating expenses = Operating profit (§9.4).
 *
 * Break-even uses **fixed** expenses over the period's actual gross margin, per
 * §9.4. When the margin is zero or negative it returns null rather than a
 * number: no revenue volume covers fixed costs at a non-positive margin, and
 * printing a figure there would be a lie.
 */
export async function getProfitAndLoss(
  period: Period,
  exec: Executor = db,
): Promise<ProfitAndLoss> {
  const [sales, expenses] = await Promise.all([
    getSalesTotals(period, exec),
    getExpenseTotals(period, exec),
  ]);

  const operatingProfit = sales.grossProfitCents - expenses.totalCents;
  const breakEven = breakEvenRevenueCents(expenses.fixedCents, sales.grossMargin);

  return {
    period,
    revenueCents: sales.revenueCents,
    cogsCents: sales.cogsCents,
    grossProfitCents: sales.grossProfitCents,
    grossMargin: sales.grossMargin,
    operatingExpensesCents: expenses.totalCents,
    fixedExpensesCents: expenses.fixedCents,
    variableExpensesCents: expenses.variableCents,
    operatingProfitCents: operatingProfit,
    expenseRatio:
      sales.revenueCents > 0 ? expenses.totalCents / sales.revenueCents : null,
    breakEvenRevenueCents: breakEven,
    breakEvenProgress:
      breakEven === null || breakEven === 0
        ? null
        : sales.revenueCents / breakEven,
  };
}

/** Monthly expense totals with the previous month, for §9.4's comparison. */
export async function getExpenseComparison(
  month: string,
  exec: Executor = db,
): Promise<{
  current: ExpenseTotals;
  previous: ExpenseTotals;
  deltaCents: number;
  deltaRatio: number | null;
}> {
  const start = startOfMonth(month);
  const prevStart = startOfMonth(
    new Date(
      Number(start.slice(0, 4)),
      Number(start.slice(5, 7)) - 2,
      1,
    )
      .toISOString()
      .slice(0, 10),
  );

  const [current, previous] = await Promise.all([
    getExpenseTotals({ preset: "custom", from: start, to: endOfMonth(start) }, exec),
    getExpenseTotals(
      { preset: "custom", from: prevStart, to: endOfMonth(prevStart) },
      exec,
    ),
  ]);

  const delta = current.totalCents - previous.totalCents;
  return {
    current,
    previous,
    deltaCents: delta,
    deltaRatio: previous.totalCents > 0 ? delta / previous.totalCents : null,
  };
}

// ---------------------------------------------------------------------------
// Frozen stock (§4.3)
// ---------------------------------------------------------------------------

export interface FrozenRow {
  productId: string;
  sku: string;
  name: string;
  categoryName: string | null;
  onHand: number;
  daysIdle: number | null;
  lastSaleDate: string | null;
  movement: MovementStatus;
  valueAtCostCents: number;
  marketPriceCents: number;
  exportPriceCents: number;
}

/** Products classified Slow or Frozen, with the capital tied up in them. */
export async function getFrozenStock(
  exec: Executor = db,
  opts: { include?: MovementStatus[] } = {},
): Promise<{ rows: FrozenRow[]; totalValueCents: number; frozenDays: number }> {
  const settings = await getSettings(exec);
  const include = opts.include ?? ["FROZEN"];

  const rows = (await exec.execute(sql`
    SELECT p.id                              AS product_id,
           p.sku                             AS sku,
           p.name                            AS name,
           cat.name                          AS category_name,
           COALESCE(ps.on_hand, 0)           AS on_hand,
           ps.last_sale_date                 AS last_sale_date,
           ps.last_receipt_date              AS last_receipt_date,
           p.cost_price_cents                AS cost_price_cents,
           p.market_price_cents              AS market_price_cents,
           p.export_price_cents              AS export_price_cents
      FROM products p
      LEFT JOIN product_stock ps ON ps.product_id = p.id
      LEFT JOIN categories cat   ON cat.id = p.category_id
     WHERE p.status = 'ACTIVE'
       AND COALESCE(ps.on_hand, 0) > 0
  `)) as unknown as Record<string, unknown>[];

  const now = today();
  const mapped: FrozenRow[] = [];

  for (const r of rows) {
    const lastSale = r.last_sale_date === null ? null : String(r.last_sale_date);
    const lastReceipt = r.last_receipt_date === null ? null : String(r.last_receipt_date);
    const sinceSale = daysSince(lastSale, now);
    const inWarehouse = daysSince(lastReceipt, now);
    const movement = movementStatusFor(
      sinceSale,
      inWarehouse,
      settings.slowDays,
      settings.frozenDays,
    );
    if (!include.includes(movement)) continue;

    const onHand = Number(r.on_hand);
    mapped.push({
      productId: String(r.product_id),
      sku: String(r.sku),
      name: String(r.name),
      categoryName: r.category_name === null ? null : String(r.category_name),
      onHand,
      daysIdle: sinceSale ?? inWarehouse,
      lastSaleDate: lastSale,
      movement,
      valueAtCostCents: onHand * Number(r.cost_price_cents),
      marketPriceCents: Number(r.market_price_cents),
      exportPriceCents: Number(r.export_price_cents),
    });
  }

  mapped.sort((a, b) => (b.daysIdle ?? 0) - (a.daysIdle ?? 0));

  return {
    rows: mapped,
    totalValueCents: mapped.reduce((s, r) => s + r.valueAtCostCents, 0),
    frozenDays: settings.frozenDays,
  };
}

// ---------------------------------------------------------------------------
// ABC / XYZ (§4.4)
// ---------------------------------------------------------------------------

export type AbcClass = "A" | "B" | "C";
export type XyzClass = "X" | "Y" | "Z";

export interface AbcXyzRow {
  productId: string;
  sku: string;
  name: string;
  revenueCents: number;
  revenueShare: number;
  cumulativeShare: number;
  abc: AbcClass;
  /** Coefficient of variation of monthly sales, as a fraction. */
  variation: number | null;
  xyz: XyzClass;
  unitsSold: number;
  monthlyUnits: number[];
}

/**
 * §4.4 ABC by revenue share and XYZ by demand stability.
 *
 * ABC walks products from largest revenue down: those inside the first 80% of
 * cumulative revenue are A, up to 95% are B, the rest C.
 *
 * XYZ is the coefficient of variation (standard deviation ÷ mean) of monthly
 * unit sales across the period's months, compared against the configurable
 * thresholds. A product with fewer than two months of history has no meaningful
 * variation, so its variation is null and it is classified Z — erratic is the
 * honest reading of "we have barely seen it".
 */
export async function getAbcXyz(
  period: Period,
  exec: Executor = db,
): Promise<{ rows: AbcXyzRow[]; months: string[]; totalRevenueCents: number }> {
  const settings = await getSettings(exec);
  const months = monthRange(period.from, period.to);

  const rows = (await exec.execute(sql`
    SELECT p.id                                     AS product_id,
           p.sku                                    AS sku,
           p.name                                   AS name,
           to_char(o.actual_ship_date, 'YYYY-MM')   AS month,
           COALESCE(SUM(oi.unit_price_cents * oi.qty_ordered_units), 0) AS revenue,
           COALESCE(SUM(oi.qty_ordered_units), 0)   AS units
      FROM order_items oi
      JOIN orders o   ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
     WHERE o.status = 'SHIPPED'
       AND o.actual_ship_date BETWEEN ${period.from} AND ${period.to}
     GROUP BY p.id, p.sku, p.name, to_char(o.actual_ship_date, 'YYYY-MM')
  `)) as unknown as Record<string, unknown>[];

  // Returns net off both the revenue ranking and the demand series.
  const returnRows = (await exec.execute(sql`
    SELECT ri.product_id                            AS product_id,
           to_char(r.return_date, 'YYYY-MM')        AS month,
           COALESCE(SUM(ri.unit_price_cents * ri.qty_units), 0) AS revenue,
           COALESCE(SUM(ri.qty_units), 0)           AS units
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
     WHERE r.return_date BETWEEN ${period.from} AND ${period.to}
     GROUP BY ri.product_id, to_char(r.return_date, 'YYYY-MM')
  `)) as unknown as Record<string, unknown>[];

  interface Acc {
    productId: string;
    sku: string;
    name: string;
    revenueCents: number;
    unitsSold: number;
    byMonth: Map<string, number>;
  }
  const acc = new Map<string, Acc>();

  for (const r of rows) {
    const id = String(r.product_id);
    const entry =
      acc.get(id) ??
      {
        productId: id,
        sku: String(r.sku),
        name: String(r.name),
        revenueCents: 0,
        unitsSold: 0,
        byMonth: new Map<string, number>(),
      };
    entry.revenueCents += Number(r.revenue);
    entry.unitsSold += Number(r.units);
    entry.byMonth.set(
      String(r.month),
      (entry.byMonth.get(String(r.month)) ?? 0) + Number(r.units),
    );
    acc.set(id, entry);
  }

  for (const r of returnRows) {
    const id = String(r.product_id);
    const entry = acc.get(id);
    // A return for a product with no sales in the period cannot rank; skip it.
    if (!entry) continue;
    entry.revenueCents -= Number(r.revenue);
    entry.unitsSold -= Number(r.units);
    entry.byMonth.set(
      String(r.month),
      (entry.byMonth.get(String(r.month)) ?? 0) - Number(r.units),
    );
  }

  const list = [...acc.values()].sort((a, b) => b.revenueCents - a.revenueCents);
  const totalRevenue = list.reduce((s, r) => s + r.revenueCents, 0);

  let cumulative = 0;
  const out: AbcXyzRow[] = list.map((entry) => {
    const share = totalRevenue > 0 ? entry.revenueCents / totalRevenue : 0;
    // Classify on the cumulative share BEFORE this product, so a product is A
    // when it falls inside the first 80% of revenue. Using the share *after*
    // would demote the single biggest seller to B whenever it alone exceeds 80%
    // — the opposite of what §4.4 means by "products generating the first 80%".
    const cumulativeBefore = cumulative;
    cumulative += share;

    const abc: AbcClass =
      cumulativeBefore < 0.8 ? "A" : cumulativeBefore < 0.95 ? "B" : "C";

    const series = months.map((m) => entry.byMonth.get(m) ?? 0);
    const variation = coefficientOfVariation(series);
    const xyz: XyzClass =
      variation === null
        ? "Z"
        : variation * 100 <= settings.xyzXMaxPct
          ? "X"
          : variation * 100 <= settings.xyzYMaxPct
            ? "Y"
            : "Z";

    return {
      productId: entry.productId,
      sku: entry.sku,
      name: entry.name,
      revenueCents: entry.revenueCents,
      revenueShare: share,
      cumulativeShare: cumulative,
      abc,
      variation,
      xyz,
      unitsSold: entry.unitsSold,
      monthlyUnits: series,
    };
  });

  return { rows: out, months, totalRevenueCents: totalRevenue };
}

/**
 * Coefficient of variation: standard deviation ÷ mean. Null when there is not
 * enough of a series to speak of, or when the mean is zero.
 */
export function coefficientOfVariation(series: number[]): number | null {
  if (series.length < 2) return null;
  const mean = series.reduce((s, n) => s + n, 0) / series.length;
  if (mean === 0) return null;
  // Population standard deviation: the series is the whole period, not a sample.
  const variance =
    series.reduce((s, n) => s + (n - mean) ** 2, 0) / series.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

/** The 3×3 matrix cells (§4.4). */
export function abcXyzMatrix(rows: AbcXyzRow[]): Record<string, AbcXyzRow[]> {
  const cells: Record<string, AbcXyzRow[]> = {};
  for (const abc of ["A", "B", "C"] as AbcClass[]) {
    for (const xyz of ["X", "Y", "Z"] as XyzClass[]) {
      cells[`${abc}${xyz}`] = [];
    }
  }
  for (const row of rows) cells[`${row.abc}${row.xyz}`].push(row);
  return cells;
}

// ---------------------------------------------------------------------------
// Stock value dynamics (§10.3 report 4)
// ---------------------------------------------------------------------------

export interface StockValueMonth {
  month: string;
  closingUnits: number;
  closingValueAtCostCents: number;
}

/**
 * Closing stock value month by month.
 *
 * Quantities come from the ledger, so a month's close is the sum of every
 * movement up to its end — historically accurate. Value uses today's cost
 * price, which is the honest limitation of a single cost per product: the
 * system does not keep a cost history, so this is "what that stock would be
 * worth at current cost", not a restatement of the past.
 */
export async function getStockValueDynamics(
  period: Period,
  exec: Executor = db,
): Promise<StockValueMonth[]> {
  const months = monthRange(period.from, period.to);
  if (months.length === 0) return [];

  const rows = (await exec.execute(sql`
    WITH bounds AS (
      SELECT unnest(${sql.raw(`ARRAY[${months.map((m) => `'${m}-01'`).join(",")}]::date[]`)}) AS month_start
    )
    SELECT to_char(b.month_start, 'YYYY-MM')                     AS month,
           COALESCE(SUM(m.qty_units), 0)                         AS units,
           COALESCE(SUM(m.qty_units * p.cost_price_cents), 0)    AS value
      FROM bounds b
      LEFT JOIN stock_movements m
             ON m.movement_date <= (b.month_start + INTERVAL '1 month - 1 day')
      LEFT JOIN products p ON p.id = m.product_id
     GROUP BY b.month_start
     ORDER BY b.month_start
  `)) as unknown as Record<string, unknown>[];

  return rows.map((r) => ({
    month: String(r.month),
    closingUnits: Number(r.units),
    closingValueAtCostCents: Number(r.value),
  }));
}

// ---------------------------------------------------------------------------
// Dashboard aggregate (§10.1)
// ---------------------------------------------------------------------------

export interface DirectorDashboard {
  salesTodayCents: number;
  salesMonthCents: number;
  pnl: ProfitAndLoss;
  monthLabel: string;
}

export async function getDirectorDashboard(
  now: string = today(),
  exec: Executor = db,
): Promise<DirectorDashboard> {
  const monthStart = startOfMonth(now);
  const monthPeriod: Period = {
    preset: "this_month",
    from: monthStart,
    to: endOfMonth(monthStart),
  };

  const [todayTotals, pnl] = await Promise.all([
    getSalesTotals({ preset: "today", from: now, to: now }, exec),
    getProfitAndLoss(monthPeriod, exec),
  ]);

  return {
    salesTodayCents: todayTotals.revenueCents,
    salesMonthCents: pnl.revenueCents,
    pnl,
    monthLabel: monthKey(now),
  };
}

/** Top customers by outstanding debt, for the dashboard (§10.1). */
export async function getTopDebtors(
  limit = 5,
  exec: Executor = db,
): Promise<{ customerId: string; name: string; debtCents: number; grade: CustomerGrade | null }[]> {
  const { getReceivables } = await import("@/lib/queries/receivables");
  const { rows } = await getReceivables({}, exec);

  const byCustomer = new Map<string, { name: string; debtCents: number }>();
  for (const row of rows) {
    const entry = byCustomer.get(row.customerId) ?? {
      name: row.customerName,
      debtCents: 0,
    };
    entry.debtCents += row.balanceCents;
    byCustomer.set(row.customerId, entry);
  }

  return [...byCustomer.entries()]
    .map(([customerId, v]) => ({ customerId, ...v, grade: null }))
    .sort((a, b) => b.debtCents - a.debtCents)
    .slice(0, limit);
}
