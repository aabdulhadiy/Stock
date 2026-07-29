import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { getStockValueDynamics } from "@/lib/analytics";
import { exportResponse, parseFormat } from "@/lib/export";
import { resolvePeriod } from "@/lib/dates";

/** §10.3 report 4: month-by-month closing stock value. */
export async function GET(request: Request) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const url = new URL(request.url);
  const p = (key: string) => url.searchParams.get(key) ?? undefined;

  const period = resolvePeriod(p("preset") ?? "this_year", p("from"), p("to"));
  const rows = await getStockValueDynamics(period);

  return exportResponse(parseFormat(p("format")), {
    filenameBase: `${t("report.stockValue")}-${period.from}-${period.to}`,
    title: t("report.stockValue"),
    subtitle: t("report.periodLabel", {
      from: formatDate(period.from),
      to: formatDate(period.to),
    }),
    tables: [
      {
        title: t("report.stockValue"),
        columns: [
          { header: t("report.month"), key: "month", weight: 1 },
          { header: t("report.closingUnits"), key: "units", numeric: true, weight: 1 },
          { header: t("report.closingValue"), key: "value", numeric: true, weight: 1.4 },
        ],
        rows: rows.map((r) => ({
          month: r.month,
          units: r.closingUnits,
          value: formatMoney(r.closingValueAtCostCents, locale),
        })),
      },
    ],
  });
}
