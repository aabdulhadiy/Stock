import Link from "next/link";
import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { getFrozenStock } from "@/lib/analytics";
import type { MovementStatus } from "@/lib/dto";
import {
  Badge,
  Card,
  EmptyState,
  StatTile,
  Table,
  Td,
  Tf,
  Th,
  Toolbar,
  PageHeader,
} from "@/components/ui";
import {
  ExportButtons,
  FilterForm,
  SelectField,
  type Query,
} from "@/components/table-tools";
import { MOVEMENT_COLOR, movementStatusKey } from "@/lib/labels";
import { RepriceForm } from "./reprice";

/**
 * §4.3 frozen stock. The Director can change a product's market and export
 * prices straight from this list — discounting non-moving stock in one step,
 * with the change audit-logged.
 */
export default async function FrozenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const params = await searchParams;

  const include: MovementStatus[] =
    params.include === "SLOW"
      ? ["SLOW"]
      : params.include === "BOTH"
        ? ["SLOW", "FROZEN"]
        : ["FROZEN"];

  const query: Query = { include: params.include };
  const { rows, totalValueCents, frozenDays } = await getFrozenStock(undefined, {
    include,
  });

  return (
    <>
      <PageHeader
        title={t("frozen.title")}
        subtitle={t("frozen.subtitle", { days: frozenDays })}
      >
        <ExportButtons t={t} href="/export/frozen" query={query} />
      </PageHeader>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label={t("frozen.totalValue")} value={formatMoney(totalValueCents, locale)} tone="warning" />
        <StatTile label={t("common.products")} value={String(rows.length)} />
        <StatTile
          label={t("stock.onHand")}
          value={String(rows.reduce((s, r) => s + r.onHand, 0))}
        />
      </div>

      <Card>
        <Toolbar>
          <FilterForm action="/frozen" t={t}>
            <SelectField
              label={t("stock.filterMovement")}
              name="include"
              defaultValue={params.include ?? "FROZEN"}
              options={[
                { value: "FROZEN", label: t("stock.movement.FROZEN") },
                { value: "SLOW", label: t("stock.movement.SLOW") },
                { value: "BOTH", label: t("common.all") },
              ]}
            />
          </FilterForm>
        </Toolbar>

        {rows.length === 0 ? (
          <EmptyState title={t("frozen.empty")} hint={t("frozen.emptyHint")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("product.sku")}</Th>
                <Th>{t("common.product")}</Th>
                <Th>{t("common.category")}</Th>
                <Th numeric>{t("stock.onHand")}</Th>
                <Th numeric>{t("frozen.daysIdle")}</Th>
                <Th>{t("product.lastSale")}</Th>
                <Th numeric>{t("stock.valueCost")}</Th>
                <Th>{t("stock.movement")}</Th>
                <Th>{t("frozen.reprice")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
                  <Td className="text-muted">
                    {r.categoryName ?? t("common.uncategorized")}
                  </Td>
                  <Td numeric>{r.onHand}</Td>
                  <Td numeric className="font-medium text-amber-700">
                    {r.daysIdle ?? "—"}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">
                    {r.lastSaleDate ? formatDate(r.lastSaleDate) : t("product.neverSold")}
                  </Td>
                  <Td numeric className="font-medium">
                    {formatMoney(r.valueAtCostCents, locale)}
                  </Td>
                  <Td>
                    <Badge color={MOVEMENT_COLOR[r.movement]}>
                      {t(movementStatusKey(r.movement))}
                    </Badge>
                  </Td>
                  <Td>
                    <RepriceForm
                      productId={r.productId}
                      name={r.name}
                      marketPriceCents={r.marketPriceCents}
                      exportPriceCents={r.exportPriceCents}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Tf colSpan={3}>{t("common.total")}</Tf>
                <Tf numeric>{rows.reduce((s, r) => s + r.onHand, 0)}</Tf>
                <Tf colSpan={2} />
                <Tf numeric>{formatMoney(totalValueCents, locale)}</Tf>
                <Tf colSpan={2} />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
