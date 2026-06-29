import { requireUser } from "@/lib/auth";
import { resolveRange } from "@/lib/date-range";
import { cashPosition } from "@/lib/reports";
import { formatMoney } from "@/lib/currency";
import { Card, CardBody, EmptyState } from "@/components/ui";
import { DateFilter } from "@/components/date-filter";
import { ReportTabs } from "@/components/report-tabs";

export default async function CashReportPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const range = resolveRange(sp);
  const shopId = user.role === "SALES_MANAGER" ? (user.shopId ?? "__none__") : undefined;

  const rows = await cashPosition({ range, shopId });
  const totalUzs = rows.reduce((s, r) => s + r.uzs, 0);
  const totalUsd = rows.reduce((s, r) => s + r.usd, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted text-sm mt-1">
          Actual cash collected by currency, kept separate — what should be in each drawer.
        </p>
      </div>

      <ReportTabs role={user.role} />
      <DateFilter basePath="/reports/cash" range={range} />
      <p className="text-sm text-muted">
        {range.label}: {range.from.toLocaleDateString()} – {range.to.toLocaleDateString()}
      </p>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No sales in this period" hint="Try a different date range." />
        </Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {rows.map((r) => (
              <Card key={r.shopId}>
                <CardBody>
                  <p className="font-semibold">{r.shopName}</p>
                  <div className="mt-3 space-y-2">
                    <div>
                      <p className="text-xs text-muted">UZS collected</p>
                      <p className="text-lg font-bold tabular-nums">{formatMoney(r.uzs, "UZS")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">USD collected</p>
                      <p className="text-lg font-bold tabular-nums">{formatMoney(r.usd, "USD")}</p>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          {user.role === "ADMIN" && rows.length > 1 && (
            <Card>
              <CardBody className="flex flex-wrap gap-x-12 gap-y-2">
                <div>
                  <p className="text-xs text-muted">All shops — UZS</p>
                  <p className="text-xl font-bold tabular-nums">{formatMoney(totalUzs, "UZS")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">All shops — USD</p>
                  <p className="text-xl font-bold tabular-nums">{formatMoney(totalUsd, "USD")}</p>
                </div>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
