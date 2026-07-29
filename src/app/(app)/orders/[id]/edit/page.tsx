import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getT } from "@/i18n/server";
import { getOrderDetail } from "@/lib/queries/orders";
import { isEditable } from "@/lib/orders";
import { listProductOptions } from "@/lib/queries/products";
import { listCustomerOptions } from "@/lib/queries/customers";
import { centsToInput } from "@/lib/money";
import { today } from "@/lib/dates";
import { Alert, PageHeader } from "@/components/ui";
import { OrderForm } from "@/components/order-form";

export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const t = await getT();
  const { id } = await params;

  const actor = { id: user.sub, role: user.role };
  const order = await getOrderDetail(id, user.role);
  if (!order) notFound();
  if (!can.editOrder(actor, order)) notFound();

  if (!isEditable(order.status)) {
    return (
      <>
        <PageHeader title={t("common.edit")} subtitle={order.number} />
        <Alert variant="error">{t("order.editBlocked")}</Alert>
      </>
    );
  }

  const [products, customers] = await Promise.all([
    listProductOptions(user.role, { includeArchived: true }),
    listCustomerOptions(),
  ]);

  return (
    <>
      <PageHeader title={t("common.edit")} subtitle={order.number} />
      <OrderForm
        mode="edit"
        status={order.status as "NEW" | "PICKING" | "READY"}
        products={products}
        customers={customers}
        today={today()}
        values={{
          id: order.id,
          customerId: order.customer.id,
          // Reachable only by roles that may see sale prices, so priceType is
          // always present here; fall back to MARKET to satisfy the type.
          priceType: order.priceType ?? "MARKET",
          plannedShipDate: order.plannedShipDate,
          paymentMethod: order.paymentMethod,
          paymentTermDays: order.paymentTermDays,
          note: order.note ?? "",
          lines: order.lines.map((l) => ({
            lineId: l.id,
            productId: l.productId,
            qty: String(l.enteredQty),
            enteredAs: l.enteredAs,
            unitPrice: centsToInput(l.unitPriceCents ?? 0),
            // Existing prices are treated as deliberate, so switching the price
            // type does not silently rewrite an agreed discount (§5.2).
            overridden: true,
          })),
        }}
      />
    </>
  );
}
