import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatDate, formatDateTime, formatMoney } from "@/i18n";
import { getOrderDetail } from "@/lib/queries/orders";
import { isEditable } from "@/lib/orders";
import { today } from "@/lib/dates";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DetailRow,
  Table,
  Td,
  Tf,
  Th,
  PageHeader,
} from "@/components/ui";
import {
  AVAILABILITY_COLOR,
  AVAILABILITY_KEY,
  AVAILABILITY_ROW,
  ORDER_STATUS_COLOR,
  channelKey,
  enteredAsKey,
  orderStatusKey,
  paymentMethodKey,
  paymentTermLabel,
  priceTypeKey,
} from "@/lib/labels";
import { OrderWorkflow, PickedToggle } from "./workflow";

/**
 * Order detail — the single screen the Director and the warehouseman both work
 * from, showing each role what it is allowed to see (§2.2, §7).
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { t, locale } = await getI18n();
  const { id } = await params;

  const actor = { id: user.sub, role: user.role };
  const order = await getOrderDetail(id, user.role);
  if (!order) notFound();

  // Salespeople see only their own orders (§2.1).
  if (!can.viewAllOrders(actor) && order.createdById !== user.sub) notFound();

  const showMoney = can.seeSalePrices(actor);
  const canFulfil = can.fulfilOrder(actor);
  const canEdit = can.editOrder(actor, order) && isEditable(order.status);
  const canCancel = can.cancelOrder(actor, order) && order.status !== "SHIPPED" && order.status !== "CANCELLED";

  const isPicking = order.status === "PICKING" || order.status === "READY";
  const totalShortfall = order.lines.reduce((s, l) => s + l.shortfall, 0);

  return (
    <>
      <PageHeader
        title={order.number}
        subtitle={`${order.customer.name} · ${t(channelKey(order.customer.channel as never))}`}
      >
        <Badge color={ORDER_STATUS_COLOR[order.status]}>
          {t(orderStatusKey(order.status))}
        </Badge>
        {canEdit && (
          <Link href={`/orders/${order.id}/edit`}>
            <Button size="sm" variant="secondary">
              {t("common.edit")}
            </Button>
          </Link>
        )}
        <Link href={`/export/order/${order.id}?variant=picking&format=pdf`} prefetch={false}>
          <Button size="sm" variant="secondary">
            {t("order.pickingList")}
          </Button>
        </Link>
        {showMoney && (
          <Link href={`/export/order/${order.id}?variant=priced&format=pdf`} prefetch={false}>
            <Button size="sm" variant="secondary">
              {t("order.proforma")}
            </Button>
          </Link>
        )}
      </PageHeader>

      <OrderWorkflow
        orderId={order.id}
        status={order.status}
        fullyReserved={order.fullyReserved}
        allPicked={order.allPicked}
        shortfall={totalShortfall}
        canFulfil={canFulfil}
        canCancel={canCancel}
        today={today()}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* --- Lines ---------------------------------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("order.lines")}</CardTitle>
            <span className="text-xs text-muted">
              {order.status === "NEW" ? t("pick.availability") : t("order.reserved")}
            </span>
          </CardHeader>
          <Table>
            <thead>
              <tr>
                <Th>{t("product.sku")}</Th>
                <Th>{t("common.product")}</Th>
                <Th numeric>{t("order.ordered")}</Th>
                <Th numeric>{t("common.boxes")}</Th>
                <Th numeric>{t("order.reserved")}</Th>
                <Th numeric>{t("order.shortfall")}</Th>
                {showMoney && <Th numeric>{t("order.unitPrice")}</Th>}
                {showMoney && <Th numeric>{t("order.lineTotal")}</Th>}
                <Th>{t("pick.availability")}</Th>
                {isPicking && canFulfil && <Th>{t("pick.pickedFlag")}</Th>}
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id} className={AVAILABILITY_ROW[line.availability]}>
                  <Td className="font-mono text-xs whitespace-nowrap">
                    <Link
                      href={`/products/${line.productId}`}
                      className="text-primary hover:underline"
                    >
                      {line.sku}
                    </Link>
                  </Td>
                  <Td className="font-medium">{line.name}</Td>
                  <Td numeric>
                    {line.qtyOrderedUnits}
                    {line.enteredAs !== "UNITS" && (
                      <span className="block text-xs font-normal text-muted">
                        {line.enteredQty} {t(enteredAsKey(line.enteredAs))}
                      </span>
                    )}
                  </Td>
                  <Td numeric className="text-muted">
                    {line.boxes}
                  </Td>
                  <Td numeric className="font-medium text-amber-700">
                    {line.reservedQty}
                  </Td>
                  <Td numeric className={line.shortfall > 0 ? "font-semibold text-red-600" : "text-muted"}>
                    {line.shortfall || ""}
                  </Td>
                  {showMoney && <Td numeric>{formatMoney(line.unitPriceCents, locale)}</Td>}
                  {showMoney && (
                    <Td numeric className="font-medium">
                      {formatMoney(line.lineTotalCents, locale)}
                    </Td>
                  )}
                  <Td>
                    <Badge color={AVAILABILITY_COLOR[line.availability]}>
                      {t(AVAILABILITY_KEY[line.availability])}
                    </Badge>
                    {line.availability === "PARTIAL" && (
                      <span className="mt-1 block text-xs text-muted">
                        {t("stock.shortBy", {
                          available: line.reservedQty,
                          short: line.shortfall,
                        })}
                      </span>
                    )}
                  </Td>
                  {isPicking && canFulfil && (
                    <Td>
                      <PickedToggle
                        lineId={line.id}
                        orderId={order.id}
                        picked={line.picked}
                      />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
            {showMoney && (
              <tfoot>
                <tr>
                  <Tf colSpan={6}>{t("common.total")}</Tf>
                  <Tf />
                  <Tf numeric>{formatMoney(order.totalCents, locale)}</Tf>
                  <Tf colSpan={isPicking && canFulfil ? 2 : 1} />
                </tr>
              </tfoot>
            )}
          </Table>
        </Card>

        <div className="space-y-5">
          {/* --- Order facts ------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>{t("common.details")}</CardTitle>
            </CardHeader>
            <CardBody>
              <dl>
                <DetailRow label={t("order.customer")}>
                  <Link
                    href={`/customers/${order.customer.id}`}
                    className="text-primary hover:underline"
                  >
                    {order.customer.name}
                  </Link>
                </DetailRow>
                <DetailRow label={t("customer.phone")}>{order.customer.phone}</DetailRow>
                {order.customer.city && (
                  <DetailRow label={t("customer.city")}>{order.customer.city}</DetailRow>
                )}
                {/* Absent for the warehouseman (§2.2). */}
                {order.priceType && (
                  <DetailRow label={t("order.priceType")}>
                    {t(priceTypeKey(order.priceType))}
                  </DetailRow>
                )}
                <DetailRow label={t("order.paymentMethod")}>
                  {t(paymentMethodKey(order.paymentMethod))}
                </DetailRow>
                <DetailRow label={t("order.paymentTerm")}>
                  {paymentTermLabel(t, order.paymentTermDays)}
                </DetailRow>
                <DetailRow label={t("order.plannedShipDate")}>
                  {formatDate(order.plannedShipDate)}
                </DetailRow>
                <DetailRow label={t("order.actualShipDate")}>
                  {order.actualShipDate ? formatDate(order.actualShipDate) : "—"}
                </DetailRow>
                {order.shipDelayDays !== null && (
                  <DetailRow label={t("order.deadline")}>
                    {order.shipDelayDays > 0 ? (
                      <span className="text-red-600">
                        {t("order.lateBy", { days: order.shipDelayDays })}
                      </span>
                    ) : order.shipDelayDays < 0 ? (
                      <span className="text-emerald-700">
                        {t("order.earlyBy", { days: -order.shipDelayDays })}
                      </span>
                    ) : (
                      <span className="text-emerald-700">{t("order.onTime")}</span>
                    )}
                  </DetailRow>
                )}
                {order.dueDate && (
                  <DetailRow label={t("order.dueDate")}>{formatDate(order.dueDate)}</DetailRow>
                )}
                <DetailRow label={t("common.createdBy")}>
                  {order.createdByName ?? "—"}
                </DetailRow>
                <DetailRow label={t("common.createdAt")}>
                  {formatDateTime(order.createdAt, locale)}
                </DetailRow>
                {order.acceptedByName && (
                  <DetailRow label={t("order.accept")}>
                    {order.acceptedByName}
                    {order.acceptedAt && (
                      <span className="block text-xs font-normal text-muted">
                        {formatDateTime(order.acceptedAt, locale)}
                      </span>
                    )}
                  </DetailRow>
                )}
                {order.note && (
                  <DetailRow label={t("common.note")}>{order.note}</DetailRow>
                )}
              </dl>
            </CardBody>
          </Card>

          {/* --- Picking summary (§7.4) -------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>{t("pick.summary")}</CardTitle>
            </CardHeader>
            <CardBody>
              <dl>
                <DetailRow label={t("pick.distinctProducts")}>
                  {order.summary.distinctProducts}
                </DetailRow>
                <DetailRow label={t("pick.totalUnits")}>{order.summary.totalUnits}</DetailRow>
                <DetailRow label={t("pick.totalBoxes")}>{order.summary.totalBoxes}</DetailRow>
                <DetailRow label={t("pick.totalWeight")}>
                  {order.summary.totalWeightKg} {t("common.kg")}
                </DetailRow>
                <DetailRow label={t("pick.totalVolume")}>
                  {order.summary.totalVolumeM3} {t("common.m3")}
                </DetailRow>
              </dl>
            </CardBody>
          </Card>

          {/* --- Money (Director / Salesperson) ----------------------- */}
          {showMoney && order.totalCents !== undefined && (
            <Card>
              <CardHeader>
                <CardTitle>{t("nav.money")}</CardTitle>
              </CardHeader>
              <CardBody>
                <dl>
                  <DetailRow label={t("common.total")}>
                    {formatMoney(order.totalCents, locale)}
                  </DetailRow>
                  <DetailRow label={t("order.paid")}>
                    {formatMoney(order.paidCents ?? 0, locale)}
                  </DetailRow>
                  <DetailRow label={t("payment.remaining")}>
                    <span
                      className={
                        (order.balanceCents ?? 0) > 0 ? "text-red-600" : "text-emerald-700"
                      }
                    >
                      {formatMoney(order.balanceCents ?? 0, locale)}
                    </span>
                  </DetailRow>
                </dl>
                {can.managePayments(actor) && order.status === "SHIPPED" && (
                  <Link
                    href={`/orders/${order.id}/payments`}
                    className="mt-3 inline-block text-sm text-primary hover:underline"
                  >
                    {t("payment.record")}
                  </Link>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
