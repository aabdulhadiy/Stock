import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney, formatPercent } from "@/i18n";
import {
  getExpenseTotals,
  getProfitAndLoss,
  getSalesBreakdown,
  type SalesDimension,
} from "@/lib/analytics";
import { resolvePeriod } from "@/lib/dates";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DetailRow,
  EmptyState,
  Progress,
  StatTile,
  Table,
  Td,
  Tf,
  Th,
  PageHeader,
} from "@/components/ui";
import { PeriodFilter, periodLabel } from "@/components/period-filter";
import { SelectField, type Query } from "@/components/table-tools";
import { channelKey, expenseTypeKey } from "@/lib/labels";
import type { Channel } from "@/db/schema";

const DIMENSIONS: SalesDimension[] = ["month", "channel", "customer", "product"];
const DIMENSION_LABEL: Record<string, string> = {
  month: "report.groupBy.month",
  channel: "report.groupBy.channel",
  customer: "report.groupBy.customer",
  product: "report.groupBy.product",
};

/**
 * §10.3 report 2: gross profit by dimension from actual sold prices and cost
 * snapshots, plus operating profit once expenses are deducted.
 */
export default async function ProfitReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const params = await searchParams;

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

  const [pnl, rows, expenses] = await Promise.all([
    getProfitAndLoss(period),
    getSalesBreakdown(period, dimension),
    getExpenseTotals(period),
  ]);

  const labelFor = (key: string, label: string) =>
    dimension === "channel" ? t(channelKey(key as Channel)) : label;

  return (
    <>
      <PageHeader
        title={t("report.profit")}
        subtitle={periodLabel(t, period, formatDate)}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("report.revenue")} value={formatMoney(pnl.revenueCents, locale)} />
        <StatTile
          label={t("report.grossProfit")}
          value={formatMoney(pnl.grossProfitCents, locale)}
          sub={formatPercent(pnl.grossMargin, locale)}
          tone={pnl.grossProfitCents >= 0 ? "positive" : "negative"}
        />
        <StatTile
          label={t("report.operatingExpenses")}
          value={formatMoney(pnl.operatingExpensesCents, locale)}
          sub={formatPercent(pnl.expenseRatio, locale)}
        />
        <StatTile
          label={t("report.operatingProfit")}
          value={formatMoney(pnl.operatingProfitCents, locale)}
          tone={pnl.operatingProfitCents >= 0 ? "positive" : "negative"}
        />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("dash.pnlTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <dl>
              <DetailRow label={t("dash.revenue")}>
                {formatMoney(pnl.revenueCents, locale)}
              </DetailRow>
              <DetailRow label={t("dash.cogs")}>
                −{formatMoney(pnl.cogsCents, locale)}
              </DetailRow>
              <DetailRow label={t("dash.grossProfit")}>
                <span className="font-semibold">
                  {formatMoney(pnl.grossProfitCents, locale)}
                </span>
              </DetailRow>
              <DetailRow label={`${t("dash.operatingExpenses")} · ${t("expcat.type.FIXED")}`}>
                −{formatMoney(pnl.fixedExpensesCents, locale)}
              </DetailRow>
              <DetailRow
                label={`${t("dash.operatingExpenses")} · ${t("expcat.type.VARIABLE")}`}
              >
                −{formatMoney(pnl.variableExpensesCents, locale)}
              </DetailRow>
              <DetailRow label={t("dash.operatingProfit")}>
                <span
                  className={
                    pnl.operatingProfitCents >= 0
                      ? "text-base font-bold text-emerald-700"
                      : "text-base font-bold text-red-600"
                  }
                >
                  {formatMoney(pnl.operatingProfitCents, locale)}
                </span>
              </DetailRow>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dash.breakEvenTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            {pnl.breakEvenRevenueCents === null ? (
              <Alert variant="info">{t("dash.breakEvenUnknown")}</Alert>
            ) : (
              <>
                <Progress
                  ratio={pnl.breakEvenProgress ?? 0}
                  tone={(pnl.breakEvenProgress ?? 0) >= 1 ? "success" : "warning"}
                  label={
                    (pnl.breakEvenProgress ?? 0) >= 1
                      ? t("dash.breakEvenReached")
                      : t("dash.breakEvenRemaining", {
                          amount: formatMoney(
                            pnl.breakEvenRevenueCents - pnl.revenueCents,
                            locale,
                          ),
                        })
                  }
                />
                <dl className="mt-4">
                  <DetailRow label={t("dash.breakEvenTarget")}>
                    {formatMoney(pnl.breakEvenRevenueCents, locale)}
                  </DetailRow>
                  <DetailRow label={t("expcat.type.FIXED")}>
                    {formatMoney(pnl.fixedExpensesCents, locale)}
                  </DetailRow>
                  <DetailRow label={t("dash.grossMargin")}>
                    {formatPercent(pnl.grossMargin, locale)}
                  </DetailRow>
                </dl>
              </>
            )}

            {expenses.byCategory.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-muted">
                  {t("expense.byCategory")}
                </p>
                <dl>
                  {expenses.byCategory.slice(0, 6).map((c) => (
                    <DetailRow
                      key={c.categoryId}
                      label={`${c.name} · ${t(expenseTypeKey(c.type))}`}
                    >
                      {formatMoney(c.amountCents, locale)}
                    </DetailRow>
                  ))}
                </dl>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <PeriodFilter
          t={t}
          action="/reports/profit"
          period={period}
          exportHref="/export/profit"
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
                <Th numeric>{t("report.revenue")}</Th>
                <Th numeric>{t("report.cogs")}</Th>
                <Th numeric>{t("report.grossProfit")}</Th>
                <Th numeric>{t("report.margin")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-slate-50/60">
                  <Td className="font-medium">{labelFor(r.key, r.label)}</Td>
                  <Td numeric>{r.unitsSold}</Td>
                  <Td numeric>{formatMoney(r.revenueCents, locale)}</Td>
                  <Td numeric className="text-muted">
                    {formatMoney(r.cogsCents, locale)}
                  </Td>
                  <Td
                    numeric
                    className={
                      r.grossProfitCents >= 0
                        ? "font-medium text-emerald-700"
                        : "font-medium text-red-600"
                    }
                  >
                    {formatMoney(r.grossProfitCents, locale)}
                  </Td>
                  <Td numeric className="text-muted">
                    {formatPercent(r.grossMargin, locale)}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Tf>{t("common.total")}</Tf>
                <Tf numeric>
                  {rows.reduce((s, r) => s + r.unitsSold, 0)}
                </Tf>
                <Tf numeric>{formatMoney(pnl.revenueCents, locale)}</Tf>
                <Tf numeric>{formatMoney(pnl.cogsCents, locale)}</Tf>
                <Tf numeric>{formatMoney(pnl.grossProfitCents, locale)}</Tf>
                <Tf numeric>{formatPercent(pnl.grossMargin, locale)}</Tf>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
