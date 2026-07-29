import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney, formatPercent } from "@/i18n";
import {
  getExpenseTotals,
  getProfitAndLoss,
  getSalesBreakdown,
  type SalesDimension,
} from "@/lib/analytics";
import { exportResponse, parseFormat } from "@/lib/export";
import { resolvePeriod } from "@/lib/dates";
import { channelKey, expenseTypeKey } from "@/lib/labels";
import type { Channel } from "@/db/schema";

const DIMENSIONS: SalesDimension[] = ["month", "channel", "customer", "product"];

/** §10.3 report 2: the P&L statement plus the per-dimension profit breakdown. */
export async function GET(request: Request) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const url = new URL(request.url);
  const p = (key: string) => url.searchParams.get(key) ?? undefined;

  const period = resolvePeriod(p("preset"), p("from"), p("to"));
  const dimension = DIMENSIONS.includes(p("by") as SalesDimension)
    ? (p("by") as SalesDimension)
    : "month";

  const [pnl, rows, expenses] = await Promise.all([
    getProfitAndLoss(period),
    getSalesBreakdown(period, dimension),
    getExpenseTotals(period),
  ]);

  return exportResponse(parseFormat(p("format")), {
    filenameBase: `${t("report.profit")}-${period.from}-${period.to}`,
    title: t("report.profit"),
    subtitle: t("report.periodLabel", {
      from: formatDate(period.from),
      to: formatDate(period.to),
    }),
    tables: [
      {
        title: t("dash.pnlTitle"),
        columns: [
          { header: t("common.summary"), key: "label", weight: 2 },
          { header: t("common.amount"), key: "amount", numeric: true, weight: 1.2 },
        ],
        rows: [
          { label: t("dash.revenue"), amount: formatMoney(pnl.revenueCents, locale) },
          { label: t("dash.cogs"), amount: `-${formatMoney(pnl.cogsCents, locale)}` },
          {
            label: t("dash.grossProfit"),
            amount: formatMoney(pnl.grossProfitCents, locale),
          },
          { label: t("dash.grossMargin"), amount: formatPercent(pnl.grossMargin, locale) },
          {
            label: `${t("dash.operatingExpenses")} (${t("expcat.type.FIXED")})`,
            amount: `-${formatMoney(pnl.fixedExpensesCents, locale)}`,
          },
          {
            label: `${t("dash.operatingExpenses")} (${t("expcat.type.VARIABLE")})`,
            amount: `-${formatMoney(pnl.variableExpensesCents, locale)}`,
          },
          {
            label: t("dash.expensesPctRevenue"),
            amount: formatPercent(pnl.expenseRatio, locale),
          },
          {
            label: t("dash.breakEvenTarget"),
            amount:
              pnl.breakEvenRevenueCents === null
                ? t("dash.breakEvenUnknown")
                : formatMoney(pnl.breakEvenRevenueCents, locale),
          },
        ],
        totals: {
          label: t("dash.operatingProfit"),
          amount: formatMoney(pnl.operatingProfitCents, locale),
        },
      },
      {
        title: t("report.profit"),
        columns: [
          { header: t(`report.groupBy.${dimension}` as never), key: "label", weight: 2.2 },
          { header: t("report.unitsSold"), key: "units", numeric: true, weight: 0.9 },
          { header: t("report.revenue"), key: "revenue", numeric: true, weight: 1.2 },
          { header: t("report.cogs"), key: "cogs", numeric: true, weight: 1.2 },
          { header: t("report.grossProfit"), key: "profit", numeric: true, weight: 1.2 },
          { header: t("report.margin"), key: "margin", numeric: true, weight: 0.9 },
        ],
        rows: rows.map((r) => ({
          label: dimension === "channel" ? t(channelKey(r.key as Channel)) : r.label,
          units: r.unitsSold,
          revenue: formatMoney(r.revenueCents, locale),
          cogs: formatMoney(r.cogsCents, locale),
          profit: formatMoney(r.grossProfitCents, locale),
          margin: formatPercent(r.grossMargin, locale),
        })),
        totals: {
          label: t("common.total"),
          units: rows.reduce((s, r) => s + r.unitsSold, 0),
          revenue: formatMoney(pnl.revenueCents, locale),
          cogs: formatMoney(pnl.cogsCents, locale),
          profit: formatMoney(pnl.grossProfitCents, locale),
          margin: formatPercent(pnl.grossMargin, locale),
        },
      },
      {
        title: t("report.expenses"),
        columns: [
          { header: t("expense.category"), key: "name", weight: 2 },
          { header: t("expcat.type"), key: "type", weight: 1 },
          { header: t("common.amount"), key: "amount", numeric: true, weight: 1.2 },
        ],
        rows: expenses.byCategory.map((c) => ({
          name: c.name,
          type: t(expenseTypeKey(c.type)),
          amount: formatMoney(c.amountCents, locale),
        })),
        totals: {
          name: t("common.total"),
          amount: formatMoney(expenses.totalCents, locale),
        },
      },
    ],
  });
}
