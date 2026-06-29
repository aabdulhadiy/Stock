import { requireUser } from "@/lib/auth";
import { resolveRange } from "@/lib/date-range";
import {
  salesByShop,
  salesByManager,
  salesByProduct,
  salesByCustomer,
  discountByManager,
  type PerfRow,
} from "@/lib/reports";
import { formatMoney } from "@/lib/currency";
import { Card, CardHeader, CardTitle, Table, Th, Td, EmptyState, Badge } from "@/components/ui";
import { DateFilter } from "@/components/date-filter";
import { ReportTabs } from "@/components/report-tabs";

export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const range = resolveRange(sp);
  const isAdmin = user.role === "ADMIN";
  const shopId = isAdmin ? undefined : (user.shopId ?? "__none__");
  const scope = { range, shopId };

  const [byShop, byManager, byProduct, byCustomer, variance] = await Promise.all([
    isAdmin ? salesByShop(scope) : Promise.resolve([]),
    salesByManager(scope),
    salesByProduct(scope),
    salesByCustomer(scope),
    discountByManager(scope),
  ]);

  const empty = byProduct.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted text-sm mt-1">
          Performance in UZS-equivalent so cross-currency comparisons stay apples-to-apples.
        </p>
      </div>

      <ReportTabs role={user.role} />
      <DateFilter basePath="/reports/sales" range={range} />
      <p className="text-sm text-muted">
        {range.label}: {range.from.toLocaleDateString()} – {range.to.toLocaleDateString()}
      </p>

      {empty ? (
        <Card>
          <EmptyState title="No sales in this period" hint="Try a different date range." />
        </Card>
      ) : (
        <div className="space-y-6">
          {isAdmin && <PerfTable title="By shop" rows={byShop} firstCol="Shop" />}
          <PerfTable title="By sales manager" rows={byManager} firstCol="Manager" />
          <PerfTable title="By product (best sellers)" rows={byProduct} firstCol="Product" />
          <PerfTable title="By customer" rows={byCustomer} firstCol="Customer" />

          <Card>
            <CardHeader>
              <CardTitle>Discount / markup variance (suggested vs actual)</CardTitle>
            </CardHeader>
            <Table>
              <thead>
                <tr>
                  <Th>Manager</Th>
                  <Th className="text-right">Suggested (UZS)</Th>
                  <Th className="text-right">Actual (UZS)</Th>
                  <Th className="text-right">Variance</Th>
                </tr>
              </thead>
              <tbody>
                {variance.map((v) => (
                  <tr key={v.id}>
                    <Td className="font-medium">{v.label}</Td>
                    <Td className="text-right tabular-nums text-muted">
                      {v.suggestedUzs.toLocaleString("ru-RU")}
                    </Td>
                    <Td className="text-right tabular-nums">{v.actualUzs.toLocaleString("ru-RU")}</Td>
                    <Td className="text-right tabular-nums">
                      {v.varianceUzs === 0 ? (
                        <span className="text-muted">0</span>
                      ) : (
                        <Badge color={v.varianceUzs < 0 ? "red" : "green"}>
                          {v.varianceUzs < 0 ? "" : "+"}
                          {v.varianceUzs.toLocaleString("ru-RU")}
                        </Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}

function PerfTable({ title, rows, firstCol }: { title: string; rows: PerfRow[]; firstCol: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <Table>
        <thead>
          <tr>
            <Th>{firstCol}</Th>
            <Th className="text-right">Units sold</Th>
            <Th className="text-right">Sales</Th>
            <Th className="text-right">Revenue (UZS-equiv.)</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td className="font-medium">{r.label}</Td>
              <Td className="text-right tabular-nums">{r.units.toLocaleString()}</Td>
              <Td className="text-right tabular-nums text-muted">{r.sales.toLocaleString()}</Td>
              <Td className="text-right tabular-nums">{formatMoney(r.revenueUzs, "UZS")}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
