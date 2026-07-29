import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { getOrderDetail } from "@/lib/queries/orders";
import { exportResponse, parseFormat, type ExportColumn } from "@/lib/export";
import { AVAILABILITY_KEY, enteredAsKey, orderStatusKey, paymentTermLabel } from "@/lib/labels";

/**
 * Order export (§7.5), in two variants:
 *
 *  - `picking` — the warehouse copy: quantities, availability colours as words,
 *    and the picking summary. **No prices**, ever, for any role.
 *  - `priced`  — the Director's proforma-style copy with line prices and totals.
 *
 * The picking variant carries no prices structurally: it is built from columns
 * that have no price keys, so there is nothing to leak even if the requester is
 * a Director.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { t, locale } = await getI18n();
  const { id } = await ctx.params;
  const url = new URL(request.url);

  const actor = { id: user.sub, role: user.role };
  const order = await getOrderDetail(id, user.role);
  if (!order) return new Response("Not found", { status: 404 });

  // A salesperson may only export their own orders (§2.1).
  if (!can.viewAllOrders(actor) && order.createdById !== user.sub) {
    return new Response("Not found", { status: 404 });
  }

  const wantsPriced = url.searchParams.get("variant") === "priced";
  // Asking for prices without permission gets the warehouse copy, not an error:
  // the useful document is still available, just without the money.
  const priced = wantsPriced && can.seeSalePrices(actor);

  const subtitle = [
    order.number,
    order.customer.name,
    formatDate(order.plannedShipDate),
    t(orderStatusKey(order.status)),
  ].join(" · ");

  const columns: ExportColumn[] = [
    { header: t("product.sku"), key: "sku", weight: 1 },
    { header: t("common.product"), key: "name", weight: 2.4 },
    { header: t("order.ordered"), key: "ordered", numeric: true, weight: 0.8 },
    { header: t("order.enteredAs"), key: "entered", weight: 0.9 },
    { header: t("common.boxes"), key: "boxes", numeric: true, weight: 0.7 },
    { header: t("order.reserved"), key: "reserved", numeric: true, weight: 0.8 },
    { header: t("order.shortfall"), key: "shortfall", numeric: true, weight: 0.8 },
    { header: t("pick.availability"), key: "availability", weight: 1 },
    ...(priced
      ? [
          { header: t("order.unitPrice"), key: "unitPrice", numeric: true, weight: 0.9 },
          { header: t("order.lineTotal"), key: "lineTotal", numeric: true, weight: 1 },
        ]
      : []),
  ];

  const rows = order.lines.map((line) => ({
    sku: line.sku,
    name: line.name,
    ordered: line.qtyOrderedUnits,
    entered:
      line.enteredAs === "UNITS"
        ? `${line.enteredQty} ${t("common.pcs")}`
        : `${line.enteredQty} ${t(enteredAsKey(line.enteredAs))}`,
    boxes: line.boxes,
    reserved: line.reservedQty,
    shortfall: line.shortfall || "",
    availability: t(AVAILABILITY_KEY[line.availability]),
    ...(priced
      ? {
          unitPrice: formatMoney(line.unitPriceCents, locale),
          lineTotal: formatMoney(line.lineTotalCents, locale),
        }
      : {}),
  }));

  const totals = {
    name: t("common.total"),
    ordered: order.summary.totalUnits,
    boxes: order.summary.totalBoxes,
    reserved: order.lines.reduce((s, l) => s + l.reservedQty, 0),
    shortfall: order.lines.reduce((s, l) => s + l.shortfall, 0) || "",
    ...(priced ? { lineTotal: formatMoney(order.totalCents, locale) } : {}),
  };

  // §7.4 summary, rendered as its own small table so it prints under the list.
  const summaryTable = {
    title: t("pick.summary"),
    columns: [
      { header: t("common.summary"), key: "label", weight: 2 },
      { header: t("common.count"), key: "value", numeric: true, weight: 1 },
    ],
    rows: [
      { label: t("pick.distinctProducts"), value: order.summary.distinctProducts },
      { label: t("pick.totalUnits"), value: order.summary.totalUnits },
      { label: t("pick.totalBoxes"), value: order.summary.totalBoxes },
      {
        label: `${t("pick.totalWeight")} (${t("common.kg")})`,
        value: order.summary.totalWeightKg,
      },
      {
        label: `${t("pick.totalVolume")} (${t("common.m3")})`,
        value: order.summary.totalVolumeM3,
      },
      ...(priced
        ? [
            {
              label: t("order.paymentTerm"),
              value: paymentTermLabel(t, order.paymentTermDays),
            },
            { label: t("common.total"), value: formatMoney(order.totalCents, locale) },
          ]
        : []),
    ],
  };

  return exportResponse(parseFormat(url.searchParams.get("format")), {
    filenameBase: `${order.number}-${priced ? t("order.proforma") : t("order.pickingList")}`,
    title: priced ? t("order.proforma") : t("order.pickingList"),
    subtitle,
    note: priced ? undefined : t("report.warehouseNote"),
    tables: [{ title: t("order.lines"), columns, rows, totals }, summaryTable],
  });
}
