import Link from "next/link";
import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney, formatPercent } from "@/i18n";
import { abcXyzMatrix, getAbcXyz, type AbcClass, type XyzClass } from "@/lib/analytics";
import { resolvePeriod } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  Td,
  Tf,
  Th,
  PageHeader,
} from "@/components/ui";
import { PeriodFilter, periodLabel } from "@/components/period-filter";
import type { Query } from "@/components/table-tools";
import { cn } from "@/lib/utils";

const ABC: AbcClass[] = ["A", "B", "C"];
const XYZ: XyzClass[] = ["X", "Y", "Z"];

/** Cell tint: AX is the most valuable, CZ the discontinue candidate (§4.4). */
function cellTone(abc: AbcClass, xyz: XyzClass): string {
  if (abc === "A" && xyz === "X") return "bg-emerald-50 border-emerald-300";
  if (abc === "C" && xyz === "Z") return "bg-red-50 border-red-300";
  if (abc === "A") return "bg-emerald-50/50";
  if (abc === "C") return "bg-amber-50/50";
  return "";
}

/** §4.4 ABC/XYZ matrix, each cell linking to its product list. */
export default async function AbcXyzPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const params = await searchParams;

  // The default period is a year: XYZ needs several months to mean anything.
  const period = resolvePeriod(params.preset ?? "this_year", params.from, params.to);
  const cellKey = params.cell ?? null;

  const query: Query = {
    preset: params.preset,
    from: params.from,
    to: params.to,
    cell: params.cell,
  };

  const [{ rows, months, totalRevenueCents }, settings] = await Promise.all([
    getAbcXyz(period),
    getSettings(),
  ]);
  const matrix = abcXyzMatrix(rows);
  const selected = cellKey ? (matrix[cellKey] ?? []) : rows;

  return (
    <>
      <PageHeader
        title={t("abc.title")}
        subtitle={`${t("abc.subtitle")} · ${periodLabel(t, period, formatDate)}`}
      />

      <Card className="mb-5">
        <PeriodFilter
          t={t}
          action="/reports/abc"
          period={period}
          exportHref="/export/abc"
          query={query}
        />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title={t("abc.empty")} />
          ) : (
            <>
              {/* --- The 3x3 matrix --- */}
              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-1 text-sm">
                  <thead>
                    <tr>
                      <th />
                      {XYZ.map((xyz) => (
                        <th key={xyz} className="p-2 text-center font-semibold">
                          {xyz}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ABC.map((abc) => (
                      <tr key={abc}>
                        <th className="p-2 text-left font-semibold">{abc}</th>
                        {XYZ.map((xyz) => {
                          const key = `${abc}${xyz}`;
                          const cell = matrix[key];
                          const revenue = cell.reduce((s, r) => s + r.revenueCents, 0);
                          return (
                            <td key={key} className="p-0">
                              <Link
                                href={`/reports/abc?${new URLSearchParams({
                                  preset: period.preset,
                                  from: period.from,
                                  to: period.to,
                                  cell: key,
                                }).toString()}`}
                                className={cn(
                                  "block rounded-md border p-3 text-center transition-colors hover:border-primary",
                                  cellTone(abc, xyz),
                                  cellKey === key ? "border-primary ring-2 ring-primary/20" : "border-border",
                                )}
                              >
                                <span className="block text-lg font-bold tabular-nums">
                                  {cell.length}
                                </span>
                                <span className="block text-[11px] text-muted">
                                  {formatMoney(revenue, locale)}
                                </span>
                              </Link>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* --- Legend --- */}
              <div className="mt-4 grid gap-1 text-xs text-muted sm:grid-cols-2">
                <span>{t("abc.legendA")}</span>
                <span>
                  {t("abc.legendX")} (≤ {settings.xyzXMaxPct}%)
                </span>
                <span>{t("abc.legendB")}</span>
                <span>
                  {t("abc.legendY")} (≤ {settings.xyzYMaxPct}%)
                </span>
                <span>{t("abc.legendC")}</span>
                <span>{t("abc.legendZ")}</span>
                <span className="font-medium text-emerald-700">{t("abc.hintAX")}</span>
                <span className="font-medium text-red-700">{t("abc.hintCZ")}</span>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {cellKey ? `${cellKey} · ${t("abc.cellProducts", { count: selected.length })}` : t("common.products")}
            </CardTitle>
            {cellKey && (
              <Link
                href={`/reports/abc?preset=${period.preset}&from=${period.from}&to=${period.to}`}
                className="text-xs text-primary hover:underline"
              >
                {t("common.all")}
              </Link>
            )}
          </CardHeader>
          <Table>
            <thead>
              <tr>
                <Th>{t("product.sku")}</Th>
                <Th>{t("common.product")}</Th>
                <Th numeric>{t("report.unitsSold")}</Th>
                <Th numeric>{t("abc.revenue")}</Th>
                <Th numeric>{t("abc.revenueShare")}</Th>
                <Th numeric>{t("abc.cumulativeShare")}</Th>
                <Th numeric>{t("abc.variation")}</Th>
                <Th>{t("abc.classAbc")}</Th>
                <Th>{t("abc.classXyz")}</Th>
                {months.length <= 14 && <Th>{t("report.month")}</Th>}
              </tr>
            </thead>
            <tbody>
              {selected.map((r) => (
                <tr key={r.productId} className="hover:bg-slate-50/60">
                  <Td className="font-mono text-xs whitespace-nowrap">
                    <Link
                      href={`/products/${r.productId}`}
                      className="text-primary hover:underline"
                    >
                      {r.sku}
                    </Link>
                  </Td>
                  <Td className="font-medium">{r.name}</Td>
                  <Td numeric>{r.unitsSold}</Td>
                  <Td numeric>{formatMoney(r.revenueCents, locale)}</Td>
                  <Td numeric className="text-muted">
                    {formatPercent(r.revenueShare, locale)}
                  </Td>
                  <Td numeric className="text-muted">
                    {formatPercent(r.cumulativeShare, locale)}
                  </Td>
                  <Td numeric className="text-muted">
                    {formatPercent(r.variation, locale)}
                  </Td>
                  <Td>
                    <Badge
                      color={r.abc === "A" ? "green" : r.abc === "B" ? "blue" : "amber"}
                    >
                      {r.abc}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge
                      color={r.xyz === "X" ? "green" : r.xyz === "Y" ? "blue" : "red"}
                    >
                      {r.xyz}
                    </Badge>
                  </Td>
                  {months.length <= 14 && (
                    <Td className="font-mono text-[11px] text-muted">
                      {r.monthlyUnits.join(" · ")}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Tf colSpan={3}>{t("common.total")}</Tf>
                <Tf numeric>{formatMoney(totalRevenueCents, locale)}</Tf>
                <Tf colSpan={months.length <= 14 ? 6 : 5} />
              </tr>
            </tfoot>
          </Table>
        </Card>
      )}
    </>
  );
}
