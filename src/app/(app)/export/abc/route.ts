import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney, formatPercent } from "@/i18n";
import { abcXyzMatrix, getAbcXyz } from "@/lib/analytics";
import { exportResponse, parseFormat } from "@/lib/export";
import { resolvePeriod } from "@/lib/dates";

/** §10.3 report 6: the ABC/XYZ matrix and the classified product list. */
export async function GET(request: Request) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const url = new URL(request.url);
  const p = (key: string) => url.searchParams.get(key) ?? undefined;

  const period = resolvePeriod(p("preset") ?? "this_year", p("from"), p("to"));
  const { rows, totalRevenueCents } = await getAbcXyz(period);
  const matrix = abcXyzMatrix(rows);

  return exportResponse(parseFormat(p("format")), {
    filenameBase: `${t("abc.title")}-${period.from}-${period.to}`,
    title: t("abc.title"),
    subtitle: `${t("abc.subtitle")} · ${t("report.periodLabel", {
      from: formatDate(period.from),
      to: formatDate(period.to),
    })}`,
    tables: [
      {
        title: t("abc.matrix"),
        columns: [
          { header: t("abc.classAbc"), key: "cell", weight: 1 },
          { header: t("common.products"), key: "count", numeric: true, weight: 1 },
          { header: t("abc.revenue"), key: "revenue", numeric: true, weight: 1.4 },
        ],
        rows: Object.entries(matrix).map(([cell, list]) => ({
          cell,
          count: list.length,
          revenue: formatMoney(
            list.reduce((s, r) => s + r.revenueCents, 0),
            locale,
          ),
        })),
        totals: {
          cell: t("common.total"),
          count: rows.length,
          revenue: formatMoney(totalRevenueCents, locale),
        },
      },
      {
        title: t("common.products"),
        columns: [
          { header: t("product.sku"), key: "sku", weight: 1 },
          { header: t("common.product"), key: "name", weight: 2.2 },
          { header: t("report.unitsSold"), key: "units", numeric: true, weight: 0.9 },
          { header: t("abc.revenue"), key: "revenue", numeric: true, weight: 1.2 },
          { header: t("abc.revenueShare"), key: "share", numeric: true, weight: 0.9 },
          { header: t("abc.cumulativeShare"), key: "cumulative", numeric: true, weight: 0.9 },
          { header: t("abc.variation"), key: "variation", numeric: true, weight: 0.9 },
          { header: t("abc.classAbc"), key: "abc", weight: 0.6 },
          { header: t("abc.classXyz"), key: "xyz", weight: 0.6 },
        ],
        rows: rows.map((r) => ({
          sku: r.sku,
          name: r.name,
          units: r.unitsSold,
          revenue: formatMoney(r.revenueCents, locale),
          share: formatPercent(r.revenueShare, locale),
          cumulative: formatPercent(r.cumulativeShare, locale),
          variation: formatPercent(r.variation, locale),
          abc: r.abc,
          xyz: r.xyz,
        })),
        totals: { name: t("common.total"), revenue: formatMoney(totalRevenueCents, locale) },
      },
    ],
  });
}
