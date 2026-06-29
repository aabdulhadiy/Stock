import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSales, getShops, type SalesFilter } from "@/lib/queries";
import { formatMoney } from "@/lib/currency";
import { Button, Card, Table, Th, Td, Badge, EmptyState, Select } from "@/components/ui";
import type { Currency } from "@/db/schema";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string }>;
}) {
  const user = await requireUser();
  const { shop } = await searchParams;
  const isAdmin = user.role === "ADMIN";

  const filter: SalesFilter = isAdmin
    ? shop
      ? { shopId: shop }
      : {}
    : { shopId: user.shopId ?? "__none__" };

  const [rows, shops] = await Promise.all([getSales(filter), isAdmin ? getShops() : Promise.resolve([])]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales</h1>
          <p className="text-muted text-sm mt-1">
            {isAdmin ? "All shops." : "Your shop's sales history."}
          </p>
        </div>
        {can.recordSale(user) && (
          <Link href="/sales/new">
            <Button>New sale</Button>
          </Link>
        )}
      </div>

      {isAdmin && (
        <form action="/sales" className="flex gap-2 max-w-sm">
          <Select name="shop" defaultValue={shop ?? ""}>
            <option value="">All shops</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      )}

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No sales yet" hint={can.recordSale(user) ? "Record your first sale." : undefined} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                {isAdmin && <Th>Shop</Th>}
                <Th>Customer</Th>
                <Th>Manager</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">UZS equiv.</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.status === "VOIDED" ? "opacity-60" : undefined}>
                  <Td className="whitespace-nowrap text-muted">{new Date(s.createdAt).toLocaleString()}</Td>
                  {isAdmin && <Td>{s.shopName}</Td>}
                  <Td>{s.customerName ?? (s.customerNote ? `${s.customerNote}` : "One-time")}</Td>
                  <Td className="text-muted">{s.managerName}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(s.totalAmount, s.currency as Currency)}</Td>
                  <Td className="text-right tabular-nums text-muted">
                    {Number(s.totalAmountUzs).toLocaleString("ru-RU")}
                  </Td>
                  <Td>
                    {s.status === "COMPLETED" ? (
                      <Badge color="green">Completed</Badge>
                    ) : (
                      <Badge color="red">Voided</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Link href={`/sales/${s.id}`} className="text-primary text-sm font-medium">
                      View
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
