import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryCountItems, inventoryCounts, products, users } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n";
import { listProductOptions } from "@/lib/queries/products";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DetailRow,
  EmptyState,
  PageHeader,
  Select,
  Button,
} from "@/components/ui";
import { COUNT_STATUS_COLOR, countStatusKey } from "@/lib/labels";
import { CountSheet } from "../forms";
import { addCountLineAction } from "../actions";

/** One inventory count sheet (§4.5). */
export default async function CountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("DIRECTOR", "WAREHOUSEMAN");
  const { t, locale } = await getI18n();
  const { id } = await params;

  const actor = { id: user.sub, role: user.role };

  const [count] = await db
    .select({
      id: inventoryCounts.id,
      countDate: inventoryCounts.countDate,
      status: inventoryCounts.status,
      note: inventoryCounts.note,
      approvedAt: inventoryCounts.approvedAt,
      performedBy: users.name,
    })
    .from(inventoryCounts)
    .leftJoin(users, eq(users.id, inventoryCounts.userId))
    .where(eq(inventoryCounts.id, id));
  if (!count) notFound();

  const [lines, options] = await Promise.all([
    db
      .select({
        id: inventoryCountItems.id,
        productId: inventoryCountItems.productId,
        sku: products.sku,
        name: products.name,
        countedQty: inventoryCountItems.countedQty,
        systemQty: inventoryCountItems.systemQty,
        variance: inventoryCountItems.variance,
      })
      .from(inventoryCountItems)
      .innerJoin(products, eq(products.id, inventoryCountItems.productId))
      .where(eq(inventoryCountItems.countId, id))
      .orderBy(asc(products.name)),
    count.status === "DRAFT" ? listProductOptions(user.role) : Promise.resolve([]),
  ]);

  const varianceLines = lines.filter((l) => l.variance !== 0);

  return (
    <>
      <PageHeader title={t("count.title")} subtitle={formatDate(count.countDate)}>
        <Badge color={COUNT_STATUS_COLOR[count.status]}>
          {t(countStatusKey(count.status))}
        </Badge>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("common.details")}</CardTitle>
          </CardHeader>
          <CardBody>
            <dl>
              <DetailRow label={t("count.date")}>{formatDate(count.countDate)}</DetailRow>
              <DetailRow label={t("count.performedBy")}>
                {count.performedBy ?? "—"}
              </DetailRow>
              <DetailRow label={t("order.lineCount")}>{lines.length}</DetailRow>
              <DetailRow label={t("count.variance")}>
                {varianceLines.length === 0
                  ? t("count.noVariance")
                  : t("count.varianceSummary", {
                      lines: varianceLines.length,
                      net: varianceLines.reduce((s, l) => s + l.variance, 0),
                    })}
              </DetailRow>
              {count.approvedAt && (
                <DetailRow label={t("count.approvedBy")}>
                  {formatDateTime(count.approvedAt, locale)}
                </DetailRow>
              )}
            </dl>
          </CardBody>

          {count.status === "DRAFT" && options.length > 0 && (
            <CardBody className="border-t border-border">
              <form action={addCountLineAction} className="space-y-2">
                <input type="hidden" name="id" value={count.id} />
                <label className="block text-xs font-medium text-muted" htmlFor="addProduct">
                  {t("receipt.addProduct")}
                </label>
                <Select id="addProduct" name="productId" defaultValue="">
                  <option value="">—</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="sm" variant="secondary">
                  {t("common.add")}
                </Button>
              </form>
            </CardBody>
          )}
        </Card>

        <Card className="lg:col-span-3">
          {lines.length === 0 ? (
            <EmptyState title={t("count.empty")} hint={t("count.addAllProducts")} />
          ) : (
            <CardBody>
              <CountSheet
                countId={count.id}
                status={count.status}
                lines={lines}
                canApprove={can.approveCount(actor)}
              />
            </CardBody>
          )}
        </Card>
      </div>
    </>
  );
}
