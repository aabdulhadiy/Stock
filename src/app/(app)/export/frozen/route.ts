import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { getFrozenStock } from "@/lib/analytics";
import type { MovementStatus } from "@/lib/dto";
import { exportResponse, parseFormat } from "@/lib/export";
import { movementStatusKey } from "@/lib/labels";
import { today } from "@/lib/dates";

/** §10.3 report 5: frozen stock and the capital tied up in it. */
export async function GET(request: Request) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const url = new URL(request.url);
  const include = url.searchParams.get("include");

  const statuses: MovementStatus[] =
    include === "SLOW" ? ["SLOW"] : include === "BOTH" ? ["SLOW", "FROZEN"] : ["FROZEN"];

  const { rows, totalValueCents, frozenDays } = await getFrozenStock(undefined, {
    include: statuses,
  });

  return exportResponse(parseFormat(url.searchParams.get("format")), {
    filenameBase: `${t("frozen.title")}-${today()}`,
    title: t("frozen.title"),
    subtitle: t("frozen.subtitle", { days: frozenDays }),
    tables: [
      {
        title: t("frozen.title"),
        columns: [
          { header: t("product.sku"), key: "sku", weight: 1 },
          { header: t("common.product"), key: "name", weight: 2.2 },
          { header: t("common.category"), key: "category", weight: 1.2 },
          { header: t("stock.onHand"), key: "onHand", numeric: true, weight: 0.8 },
          { header: t("frozen.daysIdle"), key: "days", numeric: true, weight: 0.8 },
          { header: t("product.lastSale"), key: "lastSale", weight: 1 },
          { header: t("stock.valueCost"), key: "value", numeric: true, weight: 1.1 },
          { header: t("product.marketPrice"), key: "market", numeric: true, weight: 1 },
          { header: t("stock.movement"), key: "movement", weight: 0.9 },
        ],
        rows: rows.map((r) => ({
          sku: r.sku,
          name: r.name,
          category: r.categoryName ?? t("common.uncategorized"),
          onHand: r.onHand,
          days: r.daysIdle ?? "",
          lastSale: r.lastSaleDate ? formatDate(r.lastSaleDate) : t("product.neverSold"),
          value: formatMoney(r.valueAtCostCents, locale),
          market: formatMoney(r.marketPriceCents, locale),
          movement: t(movementStatusKey(r.movement)),
        })),
        totals: {
          name: t("frozen.totalValue"),
          onHand: rows.reduce((s, r) => s + r.onHand, 0),
          value: formatMoney(totalValueCents, locale),
        },
      },
    ],
  });
}
