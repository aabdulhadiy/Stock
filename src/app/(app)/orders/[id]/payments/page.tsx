import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { getOrderDetail } from "@/lib/queries/orders";
import { getOrderBalance } from "@/lib/payments";
import { today } from "@/lib/dates";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  DetailRow,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { paymentMethodKey, paymentTermLabel } from "@/lib/labels";
import { PaymentForm, DeletePaymentButton } from "./form";

/** Record and review payments against one order (§5.4). */
export default async function OrderPaymentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const { id } = await params;

  const order = await getOrderDetail(id, "DIRECTOR");
  if (!order) notFound();
  const balance = await getOrderBalance(id);

  const overdue =
    order.dueDate && balance && balance.balanceCents > 0 && order.dueDate < today();

  return (
    <>
      <PageHeader title={t("payment.title")} subtitle={`${order.number} · ${order.customer.name}`}>
        <Link href={`/orders/${order.id}`} className="text-sm text-primary hover:underline">
          {t("common.back")}
        </Link>
      </PageHeader>

      {order.status !== "SHIPPED" && (
        <div className="mb-5">
          <Alert variant="warning">{t("payment.notShipped")}</Alert>
        </div>
      )}
      {overdue && (
        <div className="mb-5">
          <Alert variant="error">
            {t("order.overdueBy", {
              days: Math.max(
                0,
                Math.round(
                  (new Date(today()).getTime() - new Date(order.dueDate!).getTime()) /
                    86400000,
                ),
              ),
            })}
          </Alert>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t("nav.money")}</CardTitle>
          </CardHeader>
          <div className="p-5">
            <dl>
              <DetailRow label={t("common.total")}>
                {formatMoney(balance?.totalCents ?? 0, locale)}
              </DetailRow>
              <DetailRow label={t("order.paid")}>
                {formatMoney(balance?.paidCents ?? 0, locale)}
              </DetailRow>
              {(balance?.returnedCents ?? 0) > 0 && (
                <DetailRow label={t("return.value")}>
                  −{formatMoney(balance?.returnedCents ?? 0, locale)}
                </DetailRow>
              )}
              <DetailRow label={t("payment.remaining")}>
                <span
                  className={
                    (balance?.balanceCents ?? 0) > 0 ? "text-red-600" : "text-emerald-700"
                  }
                >
                  {formatMoney(balance?.balanceCents ?? 0, locale)}
                </span>
              </DetailRow>
              <DetailRow label={t("order.dueDate")}>
                {order.dueDate ? formatDate(order.dueDate) : "—"}
              </DetailRow>
              <DetailRow label={t("order.paymentTerm")}>
                {paymentTermLabel(t, order.paymentTermDays)}
              </DetailRow>
            </dl>
            {balance?.fullyPaid && (
              <div className="mt-4">
                <Badge color="green">{t("payment.fullyPaid")}</Badge>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-5 lg:col-span-2">
          {order.status === "SHIPPED" && !balance?.fullyPaid && (
            <PaymentForm
              orderId={order.id}
              today={today()}
              defaultMethod={order.paymentMethod}
              balanceCents={balance?.balanceCents ?? 0}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t("payment.title")}</CardTitle>
            </CardHeader>
            {!order.payments || order.payments.length === 0 ? (
              <EmptyState title={t("payment.empty")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("payment.date")}</Th>
                    <Th numeric>{t("payment.amount")}</Th>
                    <Th>{t("payment.method")}</Th>
                    <Th>{t("common.user")}</Th>
                    <Th>{t("common.note")}</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {order.payments.map((p) => (
                    <tr key={p.id}>
                      <Td className="whitespace-nowrap">{formatDate(p.paidOn)}</Td>
                      <Td numeric className="font-medium">
                        {formatMoney(p.amountCents, locale)}
                      </Td>
                      <Td>{t(paymentMethodKey(p.method))}</Td>
                      <Td className="text-muted">{p.userName ?? "—"}</Td>
                      <Td className="text-muted">{p.note ?? ""}</Td>
                      <Td>
                        <DeletePaymentButton paymentId={p.id} orderId={order.id} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
