import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import {
  listCategories,
  listProducts,
  type ProductSort,
} from "@/lib/queries/products";
import { getSettings } from "@/lib/settings";
import {
  Badge,
  Card,
  EmptyState,
  Table,
  Td,
  Th,
  Tf,
  Thumb,
  Toolbar,
  PageHeader,
} from "@/components/ui";
import {
  CheckboxField,
  ExportButtons,
  FilterForm,
  Pagination,
  SearchField,
  SelectField,
  SortableTh,
  type Query,
} from "@/components/table-tools";
import { MOVEMENT_COLOR, movementStatusKey } from "@/lib/labels";
import { unitsToBoxes } from "@/lib/validation";

/**
 * §4.1 stock overview: on-hand / reserved / available as three separate
 * columns, with values in $ for the Director only. Sortable and filterable on
 * every column; the filter state lives in the URL so the export routes can
 * reuse it verbatim.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const { t, locale } = await getI18n();
  const params = await searchParams;

  const actor = { id: user.sub, role: user.role };
  const showValues = can.seeStockValue(actor);

  const query: Query = {
    q: params.q,
    category: params.category,
    movement: params.movement,
    below: params.below,
    sort: params.sort,
    page: params.page,
  };

  const [{ rows, total, page, pageCount }, categoryList, settings] = await Promise.all([
    listProducts(user.role, {
      search: params.q,
      categoryId: params.category ?? null,
      status: "ACTIVE",
      movement:
        params.movement === "NORMAL" ||
        params.movement === "SLOW" ||
        params.movement === "FROZEN"
          ? params.movement
          : "ALL",
      belowMinimumOnly: params.below === "1",
      sort: (params.sort as ProductSort) ?? "name",
      page: Number(params.page) || 1,
      pageSize: 50,
    }),
    listCategories({ includeArchived: true }),
    getSettings(),
  ]);

  // Totals across the visible page.
  const pageUnits = rows.reduce((s, r) => s + r.stock.onHand, 0);
  const pageValueCost = showValues
    ? rows.reduce((s, r) => s + (r.stock.valueAtCostCents ?? 0), 0)
    : 0;
  const pageValueMarket = showValues
    ? rows.reduce((s, r) => s + (r.stock.valueAtMarketCents ?? 0), 0)
    : 0;

  return (
    <>
      <PageHeader
        title={t("stock.title")}
        subtitle={t("frozen.subtitle", { days: settings.frozenDays })}
      >
        <ExportButtons t={t} href="/export/stock" query={query} />
      </PageHeader>

      <Card>
        <Toolbar>
          <FilterForm action="/stock" t={t}>
            <SearchField t={t} defaultValue={params.q} />
            <SelectField
              label={t("common.category")}
              name="category"
              defaultValue={params.category ?? ""}
              options={[
                { value: "", label: t("common.all") },
                ...categoryList.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <SelectField
              label={t("stock.filterMovement")}
              name="movement"
              defaultValue={params.movement ?? "ALL"}
              options={[
                { value: "ALL", label: t("common.all") },
                { value: "NORMAL", label: t("stock.movement.NORMAL") },
                { value: "SLOW", label: t("stock.movement.SLOW") },
                { value: "FROZEN", label: t("stock.movement.FROZEN") },
              ]}
            />
            <CheckboxField
              label={t("stock.filterBelowMin")}
              name="below"
              defaultChecked={params.below === "1"}
            />
          </FilterForm>
        </Toolbar>

        {rows.length === 0 ? (
          <EmptyState title={t("stock.empty")} hint={t("stock.emptyHint")} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="w-10" />
                  <SortableTh
                    label={t("product.sku")}
                    sortKey="sku"
                    current={params.sort}
                    basePath="/stock"
                    query={query}
                  />
                  <SortableTh
                    label={t("common.name")}
                    sortKey="name"
                    current={params.sort ?? "name"}
                    basePath="/stock"
                    query={query}
                  />
                  <Th>{t("common.category")}</Th>
                  <SortableTh
                    label={t("stock.onHand")}
                    sortKey="onHand"
                    current={params.sort}
                    basePath="/stock"
                    query={query}
                    numeric
                  />
                  <Th numeric>{t("common.boxes")}</Th>
                  <SortableTh
                    label={t("stock.reserved")}
                    sortKey="reserved"
                    current={params.sort}
                    basePath="/stock"
                    query={query}
                    numeric
                  />
                  <SortableTh
                    label={t("stock.available")}
                    sortKey="available"
                    current={params.sort}
                    basePath="/stock"
                    query={query}
                    numeric
                  />
                  {showValues && (
                    <SortableTh
                      label={t("stock.valueCost")}
                      sortKey="valueAtCost"
                      current={params.sort}
                      basePath="/stock"
                      query={query}
                      numeric
                    />
                  )}
                  {showValues && <Th numeric>{t("stock.valueMarket")}</Th>}
                  <SortableTh
                    label={t("product.daysInWarehouse")}
                    sortKey="daysInWarehouse"
                    current={params.sort}
                    basePath="/stock"
                    query={query}
                    numeric
                  />
                  <SortableTh
                    label={t("product.lastSale")}
                    sortKey="lastSale"
                    current={params.sort}
                    basePath="/stock"
                    query={query}
                  />
                  <Th>{t("stock.movement")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, stock }) => (
                  <tr key={product.id} className="hover:bg-slate-50/60">
                    <Td>
                      <Thumb src={product.mainImageUrl} alt={product.name} />
                    </Td>
                    <Td className="font-mono text-xs whitespace-nowrap">
                      <Link
                        href={`/products/${product.id}`}
                        className="text-primary hover:underline"
                      >
                        {product.sku}
                      </Link>
                    </Td>
                    <Td className="font-medium">{product.name}</Td>
                    <Td className="text-muted">
                      {product.categoryName ?? t("common.uncategorized")}
                    </Td>
                    <Td numeric>{stock.onHand}</Td>
                    <Td numeric className="text-muted">
                      {unitsToBoxes(stock.onHand, product.unitsPerBox)}
                    </Td>
                    <Td numeric className={stock.reserved > 0 ? "text-amber-700" : "text-muted"}>
                      {stock.reserved}
                    </Td>
                    <Td
                      numeric
                      className={
                        stock.belowMinimum ? "font-semibold text-red-600" : "font-medium"
                      }
                      title={stock.belowMinimum ? t("stock.belowMinimum") : undefined}
                    >
                      {stock.available}
                      {stock.belowMinimum && <span aria-hidden> ▲</span>}
                    </Td>
                    {showValues && (
                      <Td numeric>{formatMoney(stock.valueAtCostCents, locale)}</Td>
                    )}
                    {showValues && (
                      <Td numeric>{formatMoney(stock.valueAtMarketCents, locale)}</Td>
                    )}
                    <Td numeric className="text-muted">
                      {stock.daysInWarehouse ?? "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-muted">
                      {stock.lastSaleDate
                        ? formatDate(stock.lastSaleDate)
                        : t("product.neverSold")}
                    </Td>
                    <Td>
                      <Badge color={MOVEMENT_COLOR[stock.movement]}>
                        {t(movementStatusKey(stock.movement))}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <Tf colSpan={4}>{t("common.total")}</Tf>
                  <Tf numeric>{pageUnits}</Tf>
                  <Tf />
                  <Tf />
                  <Tf />
                  {showValues && <Tf numeric>{formatMoney(pageValueCost, locale)}</Tf>}
                  {showValues && <Tf numeric>{formatMoney(pageValueMarket, locale)}</Tf>}
                  <Tf colSpan={3} />
                </tr>
              </tfoot>
            </Table>
            <Pagination
              t={t}
              basePath="/stock"
              query={query}
              page={page}
              pageCount={pageCount}
              total={total}
            />
          </>
        )}
      </Card>
    </>
  );
}
