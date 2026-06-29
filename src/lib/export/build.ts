import "server-only";
import type { SessionUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getProductsList, getStockMatrix } from "@/lib/queries";
import {
  cashPosition,
  salesByShop,
  salesByManager,
  salesByProduct,
  salesByCustomer,
  discountByManager,
} from "@/lib/reports";
import type { DateRange } from "@/lib/date-range";
import type { ExcelSheet } from "./excel";
import type { PdfDoc, PdfColumn } from "./pdf";
import { groupNumber, money } from "./format";

export interface BuiltExport {
  filenameBase: string;
  sheets: ExcelSheet[];
  pdf: PdfDoc;
}

// --- Products catalog -------------------------------------------------------
export async function buildProducts(user: SessionUser): Promise<BuiltExport> {
  const showCost = can.viewCostPrice(user);
  const products = await getProductsList();

  const pdfCols: PdfColumn[] = [
    { header: "Name", key: "name", weight: 3 },
    { header: "SKU", key: "sku", weight: 2 },
    { header: "Type", key: "type", weight: 1 },
    { header: "Price (UZS)", key: "price", weight: 2, align: "right" },
    ...(showCost ? [{ header: "Cost (UZS)", key: "cost", weight: 2, align: "right" as const }] : []),
    { header: "Units/box", key: "upb", weight: 1, align: "right" },
    { header: "On hand", key: "onhand", weight: 1, align: "right" },
    { header: "Status", key: "status", weight: 1 },
  ];

  const sheetCols = [
    { header: "Name", key: "name" },
    { header: "SKU", key: "sku" },
    { header: "Type", key: "type" },
    { header: "Price (UZS)", key: "price", numeric: true },
    ...(showCost ? [{ header: "Cost (UZS)", key: "cost", numeric: true }] : []),
    { header: "Units/box", key: "upb", numeric: true },
    { header: "On hand", key: "onhand", numeric: true },
    { header: "Status", key: "status" },
  ];

  const sheetRows = products.map((p) => ({
    name: p.name,
    sku: p.sku ?? "",
    type: p.type === "CHINA" ? "China" : "National",
    price: p.suggestedPriceUzs,
    ...(showCost ? { cost: p.costPriceUzs ?? null } : {}),
    upb: p.unitsPerBox ?? null,
    onhand: p.totalOnHand,
    status: p.isActive ? "Active" : "Archived",
  }));

  const pdfRows = products.map((p) => ({
    name: p.name,
    sku: p.sku ?? "—",
    type: p.type === "CHINA" ? "China" : "National",
    price: groupNumber(p.suggestedPriceUzs),
    ...(showCost ? { cost: p.costPriceUzs != null ? groupNumber(p.costPriceUzs) : "—" } : {}),
    upb: p.unitsPerBox ?? "—",
    onhand: groupNumber(p.totalOnHand),
    status: p.isActive ? "Active" : "Archived",
  }));

  return {
    filenameBase: "product-catalog",
    sheets: [{ title: "Products", columns: sheetCols, rows: sheetRows }],
    pdf: { title: "Product catalog", tables: [{ columns: pdfCols, rows: pdfRows }] },
  };
}

// --- Stock levels -----------------------------------------------------------
export async function buildStock(user: SessionUser): Promise<BuiltExport> {
  const { locations, products, balanceFor } = await getStockMatrix();
  const visible = locations.filter((l) =>
    l.type === "WAREHOUSE" ? can.viewWarehouseStock(user) : true,
  );

  const pdfCols: PdfColumn[] = [
    { header: "Product", key: "name", weight: 3 },
    { header: "SKU", key: "sku", weight: 2 },
    ...visible.map((l) => ({ header: l.name, key: l.id, weight: 1, align: "right" as const })),
    { header: "Total", key: "total", weight: 1, align: "right" },
  ];
  const sheetCols = [
    { header: "Product", key: "name" },
    { header: "SKU", key: "sku" },
    ...visible.map((l) => ({ header: l.name, key: l.id, numeric: true })),
    { header: "Total", key: "total", numeric: true },
  ];

  const sheetRows = products.map((p) => {
    const row: Record<string, string | number | null> = { name: p.name, sku: p.sku ?? "" };
    let total = 0;
    for (const l of visible) {
      const q = balanceFor(p.id, l.id);
      row[l.id] = q;
      total += q;
    }
    row.total = total;
    return row;
  });
  const pdfRows = products.map((p) => {
    const row: Record<string, string | number | null> = { name: p.name, sku: p.sku ?? "—" };
    let total = 0;
    for (const l of visible) {
      const q = balanceFor(p.id, l.id);
      row[l.id] = groupNumber(q);
      total += q;
    }
    row.total = groupNumber(total);
    return row;
  });

  return {
    filenameBase: "stock-levels",
    sheets: [{ title: "Stock levels", columns: sheetCols, rows: sheetRows }],
    pdf: { title: "Stock levels", tables: [{ columns: pdfCols, rows: pdfRows }] },
  };
}

// --- Cash position ----------------------------------------------------------
export async function buildCash(user: SessionUser, range: DateRange): Promise<BuiltExport> {
  const shopId = user.role === "SALES_MANAGER" ? (user.shopId ?? "__none__") : undefined;
  const rows = await cashPosition({ range, shopId });
  const subtitle = `${range.label}: ${range.from.toLocaleDateString()} - ${range.to.toLocaleDateString()}`;

  return {
    filenameBase: "cash-position",
    sheets: [
      {
        title: "Cash position",
        columns: [
          { header: "Shop", key: "shop" },
          { header: "UZS collected", key: "uzs", numeric: true },
          { header: "USD collected", key: "usd", numeric: true },
        ],
        rows: rows.map((r) => ({ shop: r.shopName, uzs: r.uzs, usd: r.usd })),
      },
    ],
    pdf: {
      title: "Cash position",
      subtitle,
      tables: [
        {
          columns: [
            { header: "Shop", key: "shop", weight: 2 },
            { header: "UZS collected", key: "uzs", weight: 2, align: "right" },
            { header: "USD collected", key: "usd", weight: 2, align: "right" },
          ],
          rows: rows.map((r) => ({
            shop: r.shopName,
            uzs: money(r.uzs, "UZS"),
            usd: money(r.usd, "USD"),
          })),
        },
      ],
    },
  };
}

// --- Sales performance ------------------------------------------------------
export async function buildSales(user: SessionUser, range: DateRange): Promise<BuiltExport> {
  const isAdmin = user.role === "ADMIN";
  const shopId = isAdmin ? undefined : (user.shopId ?? "__none__");
  const scope = { range, shopId };
  const subtitle = `${range.label}: ${range.from.toLocaleDateString()} - ${range.to.toLocaleDateString()}`;

  const [byShop, byManager, byProduct, byCustomer, variance] = await Promise.all([
    isAdmin ? salesByShop(scope) : Promise.resolve([]),
    salesByManager(scope),
    salesByProduct(scope),
    salesByCustomer(scope),
    discountByManager(scope),
  ]);

  const perfSheetCols = (first: string) => [
    { header: first, key: "label" },
    { header: "Units sold", key: "units", numeric: true },
    { header: "Sales", key: "sales", numeric: true },
    { header: "Revenue (UZS-equiv)", key: "revenue", numeric: true },
  ];
  const perfPdfCols = (first: string): PdfColumn[] => [
    { header: first, key: "label", weight: 3 },
    { header: "Units", key: "units", weight: 1, align: "right" },
    { header: "Sales", key: "sales", weight: 1, align: "right" },
    { header: "Revenue (UZS)", key: "revenue", weight: 2, align: "right" },
  ];
  const perfSheetRows = (rows: { label: string; units: number; sales: number; revenueUzs: number }[]) =>
    rows.map((r) => ({ label: r.label, units: r.units, sales: r.sales, revenue: r.revenueUzs }));
  const perfPdfRows = (rows: { label: string; units: number; sales: number; revenueUzs: number }[]) =>
    rows.map((r) => ({
      label: r.label,
      units: groupNumber(r.units),
      sales: groupNumber(r.sales),
      revenue: groupNumber(r.revenueUzs),
    }));

  const sheets: ExcelSheet[] = [];
  const tables: PdfDoc["tables"] = [];

  if (isAdmin) {
    sheets.push({ title: "By shop", columns: perfSheetCols("Shop"), rows: perfSheetRows(byShop) });
    tables.push({ heading: "By shop", columns: perfPdfCols("Shop"), rows: perfPdfRows(byShop) });
  }
  sheets.push({ title: "By manager", columns: perfSheetCols("Manager"), rows: perfSheetRows(byManager) });
  tables.push({ heading: "By sales manager", columns: perfPdfCols("Manager"), rows: perfPdfRows(byManager) });
  sheets.push({ title: "By product", columns: perfSheetCols("Product"), rows: perfSheetRows(byProduct) });
  tables.push({ heading: "By product", columns: perfPdfCols("Product"), rows: perfPdfRows(byProduct) });
  sheets.push({ title: "By customer", columns: perfSheetCols("Customer"), rows: perfSheetRows(byCustomer) });
  tables.push({ heading: "By customer", columns: perfPdfCols("Customer"), rows: perfPdfRows(byCustomer) });

  sheets.push({
    title: "Variance",
    columns: [
      { header: "Manager", key: "label" },
      { header: "Suggested (UZS)", key: "suggested", numeric: true },
      { header: "Actual (UZS)", key: "actual", numeric: true },
      { header: "Variance (UZS)", key: "variance", numeric: true },
    ],
    rows: variance.map((v) => ({
      label: v.label,
      suggested: v.suggestedUzs,
      actual: v.actualUzs,
      variance: v.varianceUzs,
    })),
  });
  tables.push({
    heading: "Discount / markup variance (suggested vs actual)",
    columns: [
      { header: "Manager", key: "label", weight: 3 },
      { header: "Suggested", key: "suggested", weight: 2, align: "right" },
      { header: "Actual", key: "actual", weight: 2, align: "right" },
      { header: "Variance", key: "variance", weight: 2, align: "right" },
    ],
    rows: variance.map((v) => ({
      label: v.label,
      suggested: groupNumber(v.suggestedUzs),
      actual: groupNumber(v.actualUzs),
      variance: (v.varianceUzs > 0 ? "+" : "") + groupNumber(v.varianceUzs),
    })),
  });

  return { filenameBase: "sales-performance", sheets, pdf: { title: "Sales performance", subtitle, tables } };
}
