import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { getStockValueDynamics } from "@/lib/analytics";
import { resolvePeriod } from "@/lib/dates";
import {
  Card,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { PeriodFilter, periodLabel } from "@/components/period-filter";
import type { Query } from "@/components/table-tools";

/** §10.3 report 4: closing stock value month by month. */
export default async function StockValuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const params = await searchParams;

  const period = resolvePeriod(params.preset ?? "this_year", params.from, params.to);
  const query: Query = { preset: params.preset, from: params.from, to: params.to };
  const rows = await getStockValueDynamics(period);

  const peak = rows.reduce((m, r) => Math.max(m, r.closingValueAtCostCents), 0);

  return (
    <>
      <PageHeader
        title={t("report.stockValue")}
        subtitle={periodLabel(t, period, formatDate)}
      />

      <Card>
        <PeriodFilter
          t={t}
          action="/reports/stock-value"
          period={period}
          exportHref="/export/stock-value"
          query={query}
        />

        {rows.length === 0 ? (
          <EmptyState title={t("report.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("report.month")}</Th>
                <Th numeric>{t("report.closingUnits")}</Th>
                <Th numeric>{t("report.closingValue")}</Th>
                <Th>{t("common.share")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <Td className="font-medium whitespace-nowrap">{r.month}</Td>
                  <Td numeric>{r.closingUnits}</Td>
                  <Td numeric className="font-medium">
                    {formatMoney(r.closingValueAtCostCents, locale)}
                  </Td>
                  <Td>
                    {/* A simple inline bar: the shape of the trend matters more
                        than precise pixels here. */}
                    <div className="h-2 w-full max-w-56 rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{
                          width: peak > 0
                            ? `${(r.closingValueAtCostCents / peak) * 100}%`
                            : "0%",
                        }}
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
