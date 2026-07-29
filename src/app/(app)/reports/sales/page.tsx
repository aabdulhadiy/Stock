import { requireRole } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney, formatPercent } from "@/i18n";
import { getSalesBreakdown, getSalesTotals, type SalesDimension } from "@/lib/analytics";
import { resolvePeriod } from "@/lib/dates";
import {
  Card,
  EmptyState,
  StatTile,
  Table,
  Td,
  Tf,
  Th,
  PageHeader,
} from "@/components/ui";
import { PeriodFilter, periodLabel } from "@/components/period-filter";
import { SelectField, type Query } from "@/components/table-tools";
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

const DIMENSION_LABEL: Record<SalesDimension, string> = {
  day: "report.groupBy.day",
  month: "report.groupBy.month",
  year: "report.groupBy.year",
  channel: "report.groupBy.channel",
  customer: "report.groupBy.customer",
  product: "report.groupBy.product",
};

/** §10.3 report 1: sales by period, channel, customer or product. */
export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireRole("DIRECTOR", "SALESPERSON");
  const { t, locale } = await getI18n();
  const params = await searchParams;

  const actor = { id: user.sub, role: user.role };
  // Only the Director sees cost and therefore profit (§2.2).
  const showProfit = can.viewProfit(actor);

  const period = resolvePeriod(params.preset, params.from, params.to);
  const dimension = DIMENSIONS.includes(params.by as SalesDimension)
    ? (params.by as SalesDimension)
    : "month";

  const query: Query = {
    preset: params.preset,
    from: params.from,
    to: params.to,
    by: dimension,
  };

  const [rows, totals] = await Promise.all([
    getSalesBreakdown(period, dimension),
    getSalesTotals(period),
  ]);

  // Channel keys are enum values; everything else already has a label.
  const labelFor = (key: string, label: string) =>
    dimension === "channel" ? t(channelKey(key as Channel)) : label;

  return (
    <>
      <PageHeader
        title={t("report.sales")}
        subtitle={periodLabel(t, period, formatDate)}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("report.revenue")} value={formatMoney(totals.revenueCents, locale)} />
        <StatTile label={t("report.unitsSold")} value={String(totals.unitsSold)} />
        <StatTile label={t("report.orders")} value={String(totals.orderCount)} />
        {showProfit ? (
          <StatTile
            label={t("report.grossProfit")}
            value={formatMoney(totals.grossProfitCents, locale)}
            sub={formatPercent(totals.grossMargin, locale)}
            tone={totals.grossProfitCents >= 0 ? "positive" : "negative"}
          />
        ) : (
          <StatTile
            label={t("report.returns")}
            value={formatMoney(totals.returnedRevenueCents, locale)}
          />
        )}
      </div>

      <Card>
        <PeriodFilter
          t={t}
          action="/reports/sales"
          period={period}
          exportHref="/export/sales"
          query={query}
        >
          <SelectField
            label={t("report.groupBy")}
            name="by"
            defaultValue={dimension}
            options={DIMENSIONS.map((d) => ({
              value: d,
              label: t(DIMENSION_LABEL[d] as never),
            }))}
          />
        </PeriodFilter>

        {rows.length === 0 ? (
          <EmptyState title={t("report.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t(DIMENSION_LABEL[dimension] as never)}</Th>
                <Th numeric>{t("report.unitsSold")}</Th>
                <Th numeric>{t("report.orders")}</Th>
                <Th numeric>{t("report.revenue")}</Th>
                {showProfit && <Th numeric>{t("report.cogs")}</Th>}
                {showProfit && <Th numeric>{t("report.grossProfit")}</Th>}
                {showProfit && <Th numeric>{t("report.margin")}</Th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-slate-50/60">
                  <Td className="font-medium">{labelFor(r.key, r.label)}</Td>
                  <Td numeric>{r.unitsSold}</Td>
                  <Td numeric className="text-muted">
                    {r.orderCount}
                  </Td>
                  <Td numeric className="font-medium">
                    {formatMoney(r.revenueCents, locale)}
                  </Td>
                  {showProfit && (
                    <Td numeric className="text-muted">
                      {formatMoney(r.cogsCents, locale)}
                    </Td>
                  )}
                  {showProfit && (
                    <Td
                      numeric
                      className={
                        r.grossProfitCents >= 0 ? "text-emerald-700" : "text-red-600"
                      }
                    >
                      {formatMoney(r.grossProfitCents, locale)}
                    </Td>
                  )}
                  {showProfit && (
                    <Td numeric className="text-muted">
                      {formatPercent(r.grossMargin, locale)}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Tf>{t("common.total")}</Tf>
                <Tf numeric>{totals.unitsSold}</Tf>
                <Tf numeric>{totals.orderCount}</Tf>
                <Tf numeric>{formatMoney(totals.revenueCents, locale)}</Tf>
                {showProfit && <Tf numeric>{formatMoney(totals.cogsCents, locale)}</Tf>}
                {showProfit && (
                  <Tf numeric>{formatMoney(totals.grossProfitCents, locale)}</Tf>
                )}
                {showProfit && <Tf numeric>{formatPercent(totals.grossMargin, locale)}</Tf>}
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
