import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { getCustomer, getCustomerOrders } from "@/lib/queries/customers";
import type { OrderStatus } from "@/db/schema";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DetailRow,
  EmptyState,
  StatTile,
  Table,
  Td,
  Th,
  PageHeader,
} from "@/components/ui";
import {
  GRADE_COLOR,
  ORDER_STATUS_COLOR,
  channelKey,
  gradeKey,
  orderStatusKey,
  paymentTermLabel,
  priceTypeKey,
} from "@/lib/labels";

/** Customer page with the §8.2 auto indicators. */
export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("DIRECTOR", "SALESPERSON");
  const { t, locale } = await getI18n();
  const { id } = await params;

  const actor = { id: user.sub, role: user.role };
  const showMoney = can.seeSalePrices(actor);

  const customer = await getCustomer(id);
  if (!customer) notFound();
  const orders = await getCustomerOrders(id);

  return (
    <>
      <PageHeader
        title={customer.name}
        subtitle={`${customer.phone}${customer.city ? ` · ${customer.city}` : ""}`}
      >
        <Badge color={customer.channel === "EXPORT" ? "indigo" : "slate"}>
          {t(channelKey(customer.channel))}
        </Badge>
        {customer.grade && (
          <Badge color={GRADE_COLOR[customer.grade]}>{t(gradeKey(customer.grade))}</Badge>
        )}
        {can.editCustomers(actor) && (
          <Link href={`/customers/${customer.id}/edit`}>
            <Button size="sm" variant="secondary">
              {t("common.edit")}
            </Button>
          </Link>
        )}
      </PageHeader>

      {showMoney && (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label={t("customer.totalSales")}
            value={formatMoney(customer.salesYtdCents, locale)}
          />
          <StatTile label={t("customer.totalPaid")} value={formatMoney(customer.paidCents, locale)} />
          <StatTile
            label={t("customer.debt")}
            value={formatMoney(customer.debtCents, locale)}
            tone={customer.debtCents > 0 ? "negative" : "positive"}
          />
          <StatTile
            label={t("customer.avgDelay")}
            value={
              customer.avgDelayDays === null
                ? "—"
                : `${customer.avgDelayDays} ${t("common.days")}`
            }
            sub={t("customer.latePayments") + ": " + customer.latePaymentCount}
            tone={
              customer.avgDelayDays !== null && customer.avgDelayDays > 7
                ? "negative"
                : "default"
            }
          />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t("common.details")}</CardTitle>
          </CardHeader>
          <CardBody>
            <dl>
              <DetailRow label={t("customer.phone")}>{customer.phone}</DetailRow>
              <DetailRow label={t("customer.city")}>{customer.city ?? "—"}</DetailRow>
              <DetailRow label={t("customer.channel")}>
                {t(channelKey(customer.channel))}
              </DetailRow>
              <DetailRow label={t("customer.defaultPriceType")}>
                {t(priceTypeKey(customer.defaultPriceType))}
              </DetailRow>
              <DetailRow label={t("customer.defaultTerm")}>
                {paymentTermLabel(t, customer.defaultTermDays ?? 0)}
              </DetailRow>
              <DetailRow label={t("customer.grade")}>
                {customer.grade ? t(gradeKey(customer.grade)) : t("customer.gradeNone")}
              </DetailRow>
              {customer.note && (
                <DetailRow label={t("common.note")}>{customer.note}</DetailRow>
              )}
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("customer.orders")}</CardTitle>
          </CardHeader>
          {orders.length === 0 ? (
            <EmptyState title={t("customer.noOrders")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("order.number")}</Th>
                  <Th>{t("common.date")}</Th>
                  <Th>{t("common.status")}</Th>
                  {showMoney && <Th numeric>{t("common.total")}</Th>}
                  {showMoney && <Th numeric>{t("order.paid")}</Th>}
                  {showMoney && <Th numeric>{t("order.balance")}</Th>}
                  <Th>{t("order.dueDate")}</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <Td className="font-mono text-xs whitespace-nowrap">
                      <Link href={`/orders/${o.id}`} className="text-primary hover:underline">
                        {o.number}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">
                      {formatDate(o.actualShipDate ?? o.createdAt)}
                    </Td>
                    <Td>
                      <Badge color={ORDER_STATUS_COLOR[o.status as OrderStatus]}>
                        {t(orderStatusKey(o.status as OrderStatus))}
                      </Badge>
                    </Td>
                    {showMoney && <Td numeric>{formatMoney(o.totalCents, locale)}</Td>}
                    {showMoney && (
                      <Td numeric className="text-muted">
                        {formatMoney(o.paidCents, locale)}
                      </Td>
                    )}
                    {showMoney && (
                      <Td
                        numeric
                        className={o.balanceCents > 0 ? "font-medium text-red-600" : "text-muted"}
                      >
                        {o.status === "SHIPPED" ? formatMoney(o.balanceCents, locale) : "—"}
                      </Td>
                    )}
                    <Td className="whitespace-nowrap text-muted">
                      {o.dueDate ? formatDate(o.dueDate) : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
