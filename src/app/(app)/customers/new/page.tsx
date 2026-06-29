import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getRegionTree } from "@/lib/queries";
import { CustomerForm } from "@/components/customer-form";
import { createCustomer } from "../actions";

export default async function NewCustomerPage() {
  const user = await requireUser();
  if (!can.manageCustomers(user)) redirect("/customers");
  const regions = await getRegionTree();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New customer</h1>
        <p className="text-muted text-sm mt-1">Phone number is the unique identifier.</p>
      </div>
      <CustomerForm action={createCustomer} regions={regions} submitLabel="Create customer" />
    </div>
  );
}
