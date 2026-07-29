import { requireRole } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { listProductOptions } from "@/lib/queries/products";
import { listCustomerOptions } from "@/lib/queries/customers";
import { today } from "@/lib/dates";
import { Alert, PageHeader } from "@/components/ui";
import { OrderForm } from "@/components/order-form";

export default async function NewOrderPage() {
  const user = await requireRole("DIRECTOR", "SALESPERSON");
  const t = await getT();

  const [products, customers] = await Promise.all([
    listProductOptions(user.role),
    listCustomerOptions(),
  ]);

  return (
    <>
      <PageHeader title={t("order.new")} subtitle={t("order.availableHint")} />
      {customers.length === 0 ? (
        <Alert variant="info">{t("customer.empty")}</Alert>
      ) : (
        <OrderForm
          mode="create"
          products={products}
          customers={customers}
          today={today()}
        />
      )}
    </>
  );
}
