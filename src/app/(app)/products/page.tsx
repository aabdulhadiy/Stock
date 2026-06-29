import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProductsList } from "@/lib/queries";
import { Button, Card, Table, Th, Td, Badge, EmptyState } from "@/components/ui";
import { ExportButtons } from "@/components/export-buttons";

export default async function ProductsPage() {
  const user = await requireUser();
  const isAdmin = can.manageProducts(user);
  const showCost = can.viewCostPrice(user);
  const products = await getProductsList();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-muted text-sm mt-1">{products.length} products in catalog</p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButtons basePath="/export/products" />
          {isAdmin && (
            <>
              <Link href="/products/import">
                <Button variant="secondary">Bulk import</Button>
              </Link>
              <Link href="/products/new">
                <Button>New product</Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <Card>
        {products.length === 0 ? (
          <EmptyState
            title="No products yet"
            hint={isAdmin ? "Create one or use bulk import to get started." : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>SKU</Th>
                <Th>Type</Th>
                <Th className="text-right">Price (UZS)</Th>
                {showCost && <Th className="text-right">Cost (UZS)</Th>}
                <Th className="text-right">On hand</Th>
                <Th>Status</Th>
                {isAdmin && <Th></Th>}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="text-muted">{p.sku ?? "—"}</Td>
                  <Td>
                    <Badge color={p.type === "CHINA" ? "amber" : "blue"}>
                      {p.type === "CHINA" ? "China" : "National"}
                    </Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{p.suggestedPriceUzs.toLocaleString()}</Td>
                  {showCost && (
                    <Td className="text-right tabular-nums text-muted">
                      {p.costPriceUzs != null ? p.costPriceUzs.toLocaleString() : "—"}
                    </Td>
                  )}
                  <Td className="text-right tabular-nums">{p.totalOnHand.toLocaleString()}</Td>
                  <Td>
                    {p.isActive ? (
                      <Badge color="green">Active</Badge>
                    ) : (
                      <Badge color="slate">Archived</Badge>
                    )}
                  </Td>
                  {isAdmin && (
                    <Td className="text-right">
                      <Link href={`/products/${p.id}/edit`} className="text-primary text-sm font-medium">
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
