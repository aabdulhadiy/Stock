import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { listProducts, type ProductSort } from "@/lib/queries/products";
import { exportResponse, parseFormat, type ExportColumn } from "@/lib/export";
import { movementStatusKey } from "@/lib/labels";
import { unitsToBoxes } from "@/lib/validation";
import { today } from "@/lib/dates";

/**
 * Stock overview export (§4.1, §10.3). Honours the same query string as the
 * screen, and the same role rules: a warehouseman's file has no value columns
 * because the DTO never gave them any.
 */
export async function GET(request: Request) {
  const user = await requireUser();
  const { t, locale } = await getI18n();
  const url = new URL(request.url);
  const p = (key: string) => url.searchParams.get(key) ?? undefined;

  const showValues = can.seeStockValue({ id: user.sub, role: user.role });

  const { rows } = await listProducts(user.role, {
    search: p("q"),
    categoryId: p("category") ?? null,
    status: "ACTIVE",
    movement:
      p("movement") === "NORMAL" || p("movement") === "SLOW" || p("movement") === "FROZEN"
        ? (p("movement") as "NORMAL" | "SLOW" | "FROZEN")
        : "ALL",
    belowMinimumOnly: p("below") === "1",
    sort: (p("sort") as ProductSort) ?? "name",
    page: 1,
    // One file, whole catalogue — an export is not paginated.
    pageSize: 100_000,
  });

  const columns: ExportColumn[] = [
    { header: t("product.sku"), key: "sku", weight: 1 },
    { header: t("common.name"), key: "name", weight: 2.2 },
    { header: t("common.category"), key: "category", weight: 1.2 },
    { header: t("stock.onHand"), key: "onHand", numeric: true, weight: 0.8 },
    { header: t("common.boxes"), key: "boxes", numeric: true, weight: 0.7 },
    { header: t("stock.reserved"), key: "reserved", numeric: true, weight: 0.8 },
    { header: t("stock.available"), key: "available", numeric: true, weight: 0.8 },
    ...(showValues
      ? [
          { header: t("stock.valueCost"), key: "valueCost", numeric: true, weight: 1 },
          { header: t("stock.valueMarket"), key: "valueMarket", numeric: true, weight: 1 },
        ]
      : []),
    { header: t("product.daysInWarehouse"), key: "days", numeric: true, weight: 0.8 },
    { header: t("product.lastSale"), key: "lastSale", weight: 1 },
    { header: t("stock.movement"), key: "movement", weight: 0.9 },
  ];

  const totals = {
    name: t("common.total"),
    onHand: rows.reduce((s, r) => s + r.stock.onHand, 0),
    reserved: rows.reduce((s, r) => s + r.stock.reserved, 0),
    available: rows.reduce((s, r) => s + r.stock.available, 0),
    ...(showValues
      ? {
          valueCost: formatMoney(
            rows.reduce((s, r) => s + (r.stock.valueAtCostCents ?? 0), 0),
            locale,
          ),
          valueMarket: formatMoney(
            rows.reduce((s, r) => s + (r.stock.valueAtMarketCents ?? 0), 0),
            locale,
          ),
        }
      : {}),
  };

  return exportResponse(parseFormat(p("format")), {
    filenameBase: `${t("stock.title")}-${today()}`,
    title: t("stock.title"),
    subtitle: t("report.generatedAt", { at: formatDate(new Date()) }),
    note: showValues ? undefined : t("report.warehouseNote"),
    tables: [
      {
        title: t("stock.title"),
        columns,
        rows: rows.map(({ product, stock }) => ({
          sku: product.sku,
          name: product.name,
          category: product.categoryName ?? t("common.uncategorized"),
          onHand: stock.onHand,
          boxes: unitsToBoxes(stock.onHand, product.unitsPerBox),
          reserved: stock.reserved,
          available: stock.available,
          ...(showValues
            ? {
                valueCost: formatMoney(stock.valueAtCostCents, locale),
                valueMarket: formatMoney(stock.valueAtMarketCents, locale),
              }
            : {}),
          days: stock.daysInWarehouse ?? "",
          lastSale: stock.lastSaleDate
            ? formatDate(stock.lastSaleDate)
            : t("product.neverSold"),
          movement: t(movementStatusKey(stock.movement)),
        })),
        totals,
      },
    ],
  });
}
