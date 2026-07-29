import { requireRole } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "@/components/customer-form";

export default async function NewCustomerPage() {
  await requireRole("DIRECTOR", "SALESPERSON");
  const t = await getT();
  return (
    <>
      <PageHeader title={t("customer.new")} />
      <CustomerForm mode="create" />
    </>
  );
}
