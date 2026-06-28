import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getStockMatrix } from "@/lib/queries";
import { Button, Card, Table, Th, Td, Badge, EmptyState } from "@/components/ui";

export default async function StockPage() {
  const user = await requireUser();
  const { locations, products, balanceFor } = await getStockMatrix();

  // Column visibility by role: sales managers don't see the warehouse column.
  const visibleLocations = locations.filter((l) => {
    if (l.type === "WAREHOUSE") return can.viewWarehouseStock(user);
    return true;
  });

  const canMove = can.stockIn(user) || can.transfer(user);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Stock levels</h1>
          <p className="text-muted text-sm mt-1">
            Live on-hand quantities per product per location.
            {user.role === "SALES_MANAGER" && " Other shops are read-only."}
          </p>
        </div>
        {canMove && (
          <div className="flex gap-3">
            {can.stockIn(user) && (
              <Link href="/stock/in">
                <Button variant="secondary">Stock in</Button>
              </Link>
            )}
            {can.transfer(user) && (
              <Link href="/stock/transfer">
                <Button>Transfer</Button>
              </Link>
            )}
          </div>
        )}
      </div>

      <Card>
        {products.length === 0 ? (
          <EmptyState title="No products yet" hint="Add products to start tracking stock." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>SKU</Th>
                {visibleLocations.map((l) => (
                  <Th key={l.id} className="text-right">
                    {l.name}
                    {l.type === "SHOP" && user.role === "SALES_MANAGER" && user.shopId !== l.id && (
                      <span className="ml-1 text-[10px] uppercase text-muted">(view)</span>
                    )}
                  </Th>
                ))}
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const total = visibleLocations.reduce((sum, l) => sum + balanceFor(p.id, l.id), 0);
                return (
                  <tr key={p.id}>
                    <Td className="font-medium">
                      {p.name}
                      {!p.isActive && (
                        <Badge color="slate" className="ml-2">
                          Archived
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-muted">{p.sku ?? "—"}</Td>
                    {visibleLocations.map((l) => {
                      const q = balanceFor(p.id, l.id);
                      return (
                        <Td key={l.id} className="text-right tabular-nums">
                          {q > 0 ? q.toLocaleString() : <span className="text-muted">0</span>}
                        </Td>
                      );
                    })}
                    <Td className="text-right tabular-nums font-medium">{total.toLocaleString()}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
