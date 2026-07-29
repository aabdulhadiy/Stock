import { requireRole } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney, formatPercent } from "@/i18n";
import { getSalesBreakdown, getSalesTotals, type SalesDimension } from "@/lib/analytics";
import { exportResponse, parseFormat, type ExportColumn } from "@/lib/export";
import { resolvePeriod } from "@/lib/dates";
import { channelKey } from "@/lib/labels";
import type { Channel } from "@/db/schema";

const DIMENSIONS: SalesDimension[] = [
  "day",
  "month",
  "year",
  "channel",
  "customer",
  "product",
];

/** §10.3 report 1 export. Profit columns appear only for the Director. */
export async function GET(request: Request) {
  const user = await requireRole("DIRECTOR", "SALESPERSON");
  const { t, locale } = await getI18n();
  const url = new URL(request.url);
  const p = (key: string) => url.searchParams.get(key) ?? undefined;

  const showProfit = can.viewProfit({ id: user.sub, role: user.role });
  const period = resolvePeriod(p("preset"), p("from"), p("to"));
  const dimension = DIMENSIONS.includes(p("by") as SalesDimension)
    ? (p("by") as SalesDimension)
    : "month";

  const [rows, totals] = await Promise.all([
    getSalesBreakdown(period, dimension),
    getSalesTotals(period),
  ]);

  const columns: ExportColumn[] = [
    { header: t(`report.groupBy.${dimension}` as never), key: "label", weight: 2.2 },
    { header: t("report.unitsSold"), key: "units", numeric: true, weight: 0.9 },
    { header: t("report.orders"), key: "orders", numeric: true, weight: 0.8 },
    { header: t("report.revenue"), key: "revenue", numeric: true, weight: 1.2 },
    ...(showProfit
      ? [
          { header: t("report.cogs"), key: "cogs", numeric: true, weight: 1.2 },
          { header: t("report.grossProfit"), key: "profit", numeric: true, weight: 1.2 },
          { header: t("report.margin"), key: "margin", numeric: true, weight: 0.9 },
        ]
      : []),
  ];

  return exportResponse(parseFormat(p("format")), {
    filenameBase: `${t("report.sales")}-${period.from}-${period.to}`,
    title: t("report.sales"),
    subtitle: t("report.periodLabel", {
      from: formatDate(period.from),
      to: formatDate(period.to),
    }),
    note: showProfit ? undefined : t("report.warehouseNote"),
    tables: [
      {
        title: t("report.sales"),
        columns,
        rows: rows.map((r) => ({
          label: dimension === "channel" ? t(channelKey(r.key as Channel)) : r.label,
          units: r.unitsSold,
          orders: r.orderCount,
          revenue: formatMoney(r.revenueCents, locale),
          ...(showProfit
            ? {
                cogs: formatMoney(r.cogsCents, locale),
                profit: formatMoney(r.grossProfitCents, locale),
                margin: formatPercent(r.grossMargin, locale),
              }
            : {}),
        })),
        totals: {
          label: t("common.total"),
          units: totals.unitsSold,
          orders: totals.orderCount,
          revenue: formatMoney(totals.revenueCents, locale),
          ...(showProfit
            ? {
                cogs: formatMoney(totals.cogsCents, locale),
                profit: formatMoney(totals.grossProfitCents, locale),
                margin: formatPercent(totals.grossMargin, locale),
              }
            : {}),
        },
      },
    ],
  });
}
