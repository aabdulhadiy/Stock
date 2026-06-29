import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getCustomerById, getRegionTree } from "@/lib/queries";
import { CustomerForm } from "@/components/customer-form";
import { updateCustomer } from "../../actions";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN");
  const { id } = await params;
  const [customer, regions] = await Promise.all([getCustomerById(id), getRegionTree()]);
  if (!customer) notFound();

  const action = updateCustomer.bind(null, customer.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Edit customer</h1>
        <p className="text-muted text-sm mt-1">{customer.name}</p>
      </div>
      <CustomerForm
        action={action}
        regions={regions}
        submitLabel="Save changes"
        defaults={{
          name: customer.name,
          phone: customer.phone,
          regionId: customer.regionId,
          districtId: customer.districtId,
          notes: customer.notes,
        }}
      />
    </div>
  );
}
