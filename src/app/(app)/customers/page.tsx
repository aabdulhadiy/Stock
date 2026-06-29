import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { searchCustomers } from "@/lib/queries";
import { Button, Card, Table, Th, Td, EmptyState, Input } from "@/components/ui";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const { q = "" } = await searchParams;
  const canEdit = can.editCustomers(user);
  const customers = await searchCustomers(q);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="text-muted text-sm mt-1">Shared customer list across all shops.</p>
        </div>
        <Link href="/customers/new">
          <Button>New customer</Button>
        </Link>
      </div>

      <form className="flex gap-2 max-w-md" action="/customers">
        <Input name="q" placeholder="Search by name or phone…" defaultValue={q} />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <Card>
        {customers.length === 0 ? (
          <EmptyState title="No customers found" hint={q ? "Try a different search." : "Add your first customer."} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Region</Th>
                <Th>District</Th>
                {canEdit && <Th></Th>}
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td className="text-muted">{c.phone}</Td>
                  <Td className="text-muted">{c.regionName ?? "—"}</Td>
                  <Td className="text-muted">{c.districtName ?? "—"}</Td>
                  {canEdit && (
                    <Td className="text-right">
                      <Link href={`/customers/${c.id}/edit`} className="text-primary text-sm font-medium">
                        Edit
                      </Link>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
