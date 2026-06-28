import { requireUser } from "@/lib/auth";
import {
  getProductCounts,
  getStockByLocation,
  getTotalUnits,
  getRecentMovements,
} from "@/lib/queries";
import { Card, CardBody, Table, Th, Td, Badge, EmptyState } from "@/components/ui";
import { roleLabel } from "@/lib/permissions";

const MOVEMENT_LABELS: Record<string, string> = {
  STOCK_IN: "Stock In",
  TRANSFER: "Transfer",
  SALE_OUT: "Sale",
  VOID_RETURN: "Void return",
};

export default async function DashboardPage() {
  const user = await requireUser();
  const [counts, byLocation, totalUnits, movements] = await Promise.all([
    getProductCounts(),
    getStockByLocation(),
    getTotalUnits(),
    getRecentMovements(8),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted text-sm mt-1">
          Welcome back, {user.name} · {roleLabel(user.role)}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Active products" value={counts.active} />
        <Stat label="Total products" value={counts.total} />
        <Stat label="Total units in stock" value={totalUnits} />
        <Stat label="Locations" value={byLocation.length} />
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold">Stock by location</h3>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Location</Th>
              <Th>Type</Th>
              <Th className="text-right">Units on hand</Th>
            </tr>
          </thead>
          <tbody>
            {byLocation.map((l) => (
              <tr key={l.locationId}>
                <Td className="font-medium">{l.name}</Td>
                <Td>
                  <Badge color={l.type === "WAREHOUSE" ? "blue" : "slate"}>
                    {l.type === "WAREHOUSE" ? "Warehouse" : "Shop"}
                  </Badge>
                </Td>
                <Td className="text-right tabular-nums">{l.units.toLocaleString()}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold">Recent stock activity</h3>
        </div>
        {movements.length === 0 ? (
          <CardBody>
            <EmptyState title="No stock movements yet" hint="Stock-in and transfers will appear here." />
          </CardBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Type</Th>
                <Th>Product</Th>
                <Th>Movement</Th>
                <Th className="text-right">Qty</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <Td className="text-muted whitespace-nowrap">
                    {new Date(m.createdAt).toLocaleString()}
                  </Td>
                  <Td>{MOVEMENT_LABELS[m.type] ?? m.type}</Td>
                  <Td className="font-medium">{m.productName}</Td>
                  <Td className="text-muted">
                    {(m.fromName ?? "Supplier")} → {(m.toName ?? "Customer")}
                  </Td>
                  <Td className="text-right tabular-nums">{m.quantity}</Td>
                  <Td className="text-muted">{m.by ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardBody>
        <p className="text-sm text-muted">{label}</p>
        <p className="text-2xl font-bold mt-1 tabular-nums">{value.toLocaleString()}</p>
      </CardBody>
    </Card>
  );
}
