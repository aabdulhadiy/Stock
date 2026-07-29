import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { stockMovements, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney, formatUzsReference } from "@/i18n";
import { getProductRow } from "@/lib/queries/products";
import { getSettings } from "@/lib/settings";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DetailRow,
  EmptyState,
  Table,
  Td,
  Th,
  Thumb,
  PageHeader,
} from "@/components/ui";
import {
  MOVEMENT_COLOR,
  MOVEMENT_TYPE_COLOR,
  movementStatusKey,
  movementTypeKey,
  productStatusKey,
  basisKey,
} from "@/lib/labels";
import {
  deleteProductImageAction,
  setMainImageAction,
  setProductStatusAction,
} from "../actions";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { t, locale } = await getI18n();
  const { id } = await params;

  const actor = { id: user.sub, role: user.role };
  const row = await getProductRow(id, user.role);
  if (!row) notFound();

  const { product: p, stock, images } = row;
  const canManage = can.manageProducts(actor);
  const showCost = can.seeCost(actor);
  const showPrices = can.seeSalePrices(actor);
  const settings = await getSettings();

  // Recent ledger activity for this product (§4.2 receipt history and beyond).
  const movements = await db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      qtyUnits: stockMovements.qtyUnits,
      movementDate: stockMovements.movementDate,
      note: stockMovements.note,
      userName: users.name,
    })
    .from(stockMovements)
    .leftJoin(users, eq(users.id, stockMovements.userId))
    .where(eq(stockMovements.productId, id))
    .orderBy(desc(stockMovements.movementDate), desc(stockMovements.createdAt))
    .limit(20);

  return (
    <>
      <PageHeader title={p.name} subtitle={p.sku}>
        <Badge color={p.status === "ACTIVE" ? "green" : "slate"}>
          {t(productStatusKey(p.status))}
        </Badge>
        {canManage && (
          <>
            <Link href={`/products/${p.id}/edit`}>
              <Button size="sm">{t("common.edit")}</Button>
            </Link>
            <form action={setProductStatusAction}>
              <input type="hidden" name="id" value={p.id} />
              <input
                type="hidden"
                name="status"
                value={p.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"}
              />
              <Button size="sm" variant="secondary">
                {p.status === "ACTIVE" ? t("common.archive") : t("common.restore")}
              </Button>
            </form>
          </>
        )}
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* --- Stock ---------------------------------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("stock.title")}</CardTitle>
            <Badge color={MOVEMENT_COLOR[stock.movement]}>
              {t(movementStatusKey(stock.movement))}
            </Badge>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t("stock.onHand")}
                </p>
                <p className="text-2xl font-bold tabular-nums">{stock.onHand}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t("stock.reserved")}
                </p>
                <p className="text-2xl font-bold tabular-nums text-amber-700">
                  {stock.reserved}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t("stock.available")}
                </p>
                <p
                  className={`text-2xl font-bold tabular-nums ${
                    stock.belowMinimum ? "text-red-600" : "text-emerald-700"
                  }`}
                >
                  {stock.available}
                </p>
              </div>
            </div>

            <dl className="mt-5">
              <DetailRow label={t("product.daysInWarehouse")}>
                {stock.daysInWarehouse === null
                  ? "—"
                  : `${stock.daysInWarehouse} ${t("common.days")}`}
              </DetailRow>
              <DetailRow label={t("product.lastSale")}>
                {stock.lastSaleDate ? formatDate(stock.lastSaleDate) : t("product.neverSold")}
              </DetailRow>
              <DetailRow label={t("product.daysSinceSale")}>
                {stock.daysSinceSale === null ? "—" : stock.daysSinceSale}
              </DetailRow>
              <DetailRow label={t("product.minStock")}>
                {stock.minStock ?? "—"}
              </DetailRow>
              <DetailRow label={t("common.boxes")}>
                {Math.floor(stock.onHand / Math.max(1, p.unitsPerBox))}
              </DetailRow>
            </dl>
          </CardBody>
        </Card>

        {/* --- Images -------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>{t("product.images")}</CardTitle>
          </CardHeader>
          <CardBody>
            {images.length === 0 ? (
              <p className="text-sm text-muted">{t("product.noImage")}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {images.map((img) => (
                  <div key={img.id} className="space-y-1">
                    <Thumb src={img.url} alt={p.name} size={84} />
                    {img.isMain ? (
                      <Badge color="indigo">{t("product.mainImage")}</Badge>
                    ) : (
                      canManage && (
                        <form action={setMainImageAction}>
                          <input type="hidden" name="imageId" value={img.id} />
                          <button className="text-[11px] text-primary hover:underline">
                            {t("product.setMain")}
                          </button>
                        </form>
                      )
                    )}
                    {canManage && (
                      <form action={deleteProductImageAction}>
                        <input type="hidden" name="imageId" value={img.id} />
                        <button className="text-[11px] text-red-600 hover:underline">
                          {t("common.delete")}
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* --- Pricing (role-scoped) ----------------------------------- */}
        {(showCost || showPrices) && (
          <Card>
            <CardHeader>
              <CardTitle>{t("product.pricing")}</CardTitle>
            </CardHeader>
            <CardBody>
              <dl>
                {showCost && (
                  <DetailRow label={t("product.costPrice")}>
                    {formatMoney(p.costPriceCents, locale)}
                  </DetailRow>
                )}
                {showPrices && (
                  <>
                    <DetailRow label={t("product.marketPrice")}>
                      <span className="block">{formatMoney(p.marketPriceCents, locale)}</span>
                      <span className="block text-xs font-normal text-muted">
                        {formatUzsReference(p.marketPriceCents ?? 0, settings.uzsPerUsd, locale)}
                      </span>
                    </DetailRow>
                    <DetailRow label={t("product.exportPrice")}>
                      <span className="block">{formatMoney(p.exportPriceCents, locale)}</span>
                      <span className="block text-xs font-normal text-muted">
                        {formatUzsReference(p.exportPriceCents ?? 0, settings.uzsPerUsd, locale)}
                      </span>
                    </DetailRow>
                  </>
                )}
              </dl>

              {showCost && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-xs uppercase tracking-wide text-muted mb-2">
                    {t("product.stockValue")}
                  </p>
                  <dl>
                    <DetailRow label={t("product.valueAtCost")}>
                      {formatMoney(stock.valueAtCostCents, locale)}
                    </DetailRow>
                    <DetailRow label={t("product.valueAtMarket")}>
                      {formatMoney(stock.valueAtMarketCents, locale)}
                    </DetailRow>
                    <DetailRow label={t("product.valueAtExport")}>
                      {formatMoney(stock.onHand * (p.exportPriceCents ?? 0), locale)}
                    </DetailRow>
                  </dl>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* --- Packing ------------------------------------------------- */}
        <Card className={showCost || showPrices ? "" : "lg:col-span-2"}>
          <CardHeader>
            <CardTitle>{t("product.packing")}</CardTitle>
          </CardHeader>
          <CardBody>
            <dl>
              <DetailRow label={t("product.unitsPerBox")}>{p.unitsPerBox}</DetailRow>
              <DetailRow label={t("product.unitsPerBag")}>{p.unitsPerBag ?? "—"}</DetailRow>
              <DetailRow label={t("product.boxVolume")}>
                {Number(p.boxVolumeM3)} {t("common.m3")}
              </DetailRow>
              <DetailRow label={t("product.bagVolume")}>
                {p.bagVolumeM3 ? `${Number(p.bagVolumeM3)} ${t("common.m3")}` : "—"}
              </DetailRow>
              <DetailRow label={t("product.weight")}>
                {Number(p.weightKg)} {t("common.kg")} / {t(basisKey(p.weightBasis))}
              </DetailRow>
              <DetailRow label={t("product.dims")}>
                {Number(p.dimLengthCm)}×{Number(p.dimWidthCm)}×{Number(p.dimHeightCm)}{" "}
                {t("common.cm")} / {t(basisKey(p.dimsBasis))}
              </DetailRow>
              <DetailRow label={t("common.category")}>
                {p.categoryName ?? t("common.uncategorized")}
              </DetailRow>
              <DetailRow label={t("common.createdAt")}>{formatDate(p.createdAt)}</DetailRow>
            </dl>
          </CardBody>
        </Card>
      </div>

      {/* --- Ledger ---------------------------------------------------- */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>{t("stock.ledger")}</CardTitle>
        </CardHeader>
        {movements.length === 0 ? (
          <EmptyState title={t("stock.ledgerEmpty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("common.date")}</Th>
                <Th>{t("common.type")}</Th>
                <Th numeric>{t("common.quantity")}</Th>
                <Th>{t("common.user")}</Th>
                <Th>{t("common.note")}</Th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap">{formatDate(m.movementDate)}</Td>
                  <Td>
                    <Badge color={MOVEMENT_TYPE_COLOR[m.type]}>
                      {t(movementTypeKey(m.type))}
                    </Badge>
                  </Td>
                  <Td
                    numeric
                    className={m.qtyUnits < 0 ? "text-red-600" : "text-emerald-700"}
                  >
                    {m.qtyUnits > 0 ? `+${m.qtyUnits}` : m.qtyUnits}
                  </Td>
                  <Td className="text-muted">{m.userName ?? "—"}</Td>
                  <Td className="text-muted">{m.note ?? ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
