import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { listCategories, listProducts, type ProductSort } from "@/lib/queries/products";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Table,
  Td,
  Th,
  Thumb,
  Toolbar,
  PageHeader,
} from "@/components/ui";
import {
  FilterForm,
  Pagination,
  SearchField,
  SelectField,
  SortableTh,
  type Query,
} from "@/components/table-tools";
import { productStatusKey } from "@/lib/labels";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const { t, locale } = await getI18n();
  const params = await searchParams;

  const actor = { id: user.sub, role: user.role };
  const showPrices = can.seeSalePrices(actor);
  const showCost = can.seeCost(actor);
  const canManage = can.manageProducts(actor);

  const query: Query = {
    q: params.q,
    category: params.category,
    status: params.status,
    sort: params.sort,
    page: params.page,
  };

  const [{ rows, total, page, pageCount }, categoryList] = await Promise.all([
    listProducts(user.role, {
      search: params.q,
      categoryId: params.category ?? null,
      status:
        params.status === "ARCHIVED"
          ? "ARCHIVED"
          : params.status === "ALL"
            ? "ALL"
            : "ACTIVE",
      sort: (params.sort as ProductSort) ?? "name",
      page: Number(params.page) || 1,
    }),
    listCategories({ includeArchived: true }),
  ]);

  return (
    <>
      <PageHeader title={t("product.title")}>
        {canManage && (
          <>
            <Link href="/products/categories">
              <Button variant="secondary" size="sm">
                {t("category.title")}
              </Button>
            </Link>
            <Link href="/products/import">
              <Button variant="secondary" size="sm">
                {t("import.title")}
              </Button>
            </Link>
            <Link href="/products/new">
              <Button size="sm">{t("product.new")}</Button>
            </Link>
          </>
        )}
      </PageHeader>

      <Card>
        <Toolbar>
          <FilterForm action="/products" t={t}>
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
              label={t("common.status")}
              name="status"
              defaultValue={params.status ?? "ACTIVE"}
              options={[
                { value: "ACTIVE", label: t("product.status.ACTIVE") },
                { value: "ARCHIVED", label: t("product.status.ARCHIVED") },
                { value: "ALL", label: t("common.all") },
              ]}
            />
          </FilterForm>
        </Toolbar>

        {rows.length === 0 ? (
          <EmptyState
            title={t("product.empty")}
            hint={canManage ? t("product.emptyHint") : undefined}
            action={
              canManage ? (
                <Link href="/products/new">
                  <Button size="sm">{t("product.new")}</Button>
                </Link>
              ) : undefined
            }
          />
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
                    basePath="/products"
                    query={query}
                  />
                  <SortableTh
                    label={t("common.name")}
                    sortKey="name"
                    current={params.sort ?? "name"}
                    basePath="/products"
                    query={query}
                  />
                  <Th>{t("common.category")}</Th>
                  <SortableTh
                    label={t("stock.onHand")}
                    sortKey="onHand"
                    current={params.sort}
                    basePath="/products"
                    query={query}
                    numeric
                  />
                  <SortableTh
                    label={t("stock.available")}
                    sortKey="available"
                    current={params.sort}
                    basePath="/products"
                    query={query}
                    numeric
                  />
                  {showCost && <Th numeric>{t("product.costPrice")}</Th>}
                  {showPrices && <Th numeric>{t("product.marketPrice")}</Th>}
                  {showPrices && <Th numeric>{t("product.exportPrice")}</Th>}
                  <Th>{t("product.lastSale")}</Th>
                  <Th>{t("common.status")}</Th>
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
                    <Td className="font-medium">
                      <Link href={`/products/${product.id}`} className="hover:underline">
                        {product.name}
                      </Link>
                    </Td>
                    <Td className="text-muted">
                      {product.categoryName ?? t("common.uncategorized")}
                    </Td>
                    <Td numeric>{stock.onHand}</Td>
                    <Td numeric className={stock.belowMinimum ? "text-red-600 font-semibold" : ""}>
                      {stock.available}
                    </Td>
                    {showCost && (
                      <Td numeric>{formatMoney(product.costPriceCents, locale)}</Td>
                    )}
                    {showPrices && (
                      <Td numeric>{formatMoney(product.marketPriceCents, locale)}</Td>
                    )}
                    {showPrices && (
                      <Td numeric>{formatMoney(product.exportPriceCents, locale)}</Td>
                    )}
                    <Td className="text-muted whitespace-nowrap">
                      {stock.lastSaleDate
                        ? formatDate(stock.lastSaleDate)
                        : t("product.neverSold")}
                    </Td>
                    <Td>
                      <Badge color={product.status === "ACTIVE" ? "green" : "slate"}>
                        {t(productStatusKey(product.status))}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              t={t}
              basePath="/products"
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
