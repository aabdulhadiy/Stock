import { notFound } from "next/navigation";
import { requireDirector } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { getCustomer } from "@/lib/queries/customers";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "@/components/customer-form";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireDirector();
  const t = await getT();
  const { id } = await params;

  const customer = await getCustomer(id);
  if (!customer) notFound();

  return (
    <>
      <PageHeader title={t("customer.edit")} subtitle={customer.name} />
      <CustomerForm
        mode="edit"
        values={{
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          city: customer.city,
          channel: customer.channel,
          defaultPriceType: customer.defaultPriceType,
          defaultTermDays: customer.defaultTermDays,
          note: customer.note,
        }}
      />
    </>
  );
}
