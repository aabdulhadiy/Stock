import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatMoney } from "@/i18n";
import { getFrozenSummary, getLowStockAlerts } from "@/lib/queries/products";
import { getShortfalls } from "@/lib/stock";
import { getSettings } from "@/lib/settings";
import {
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  StatTile,
  Table,
  Td,
  Th,
  PageHeader,
} from "@/components/ui";

/**
 * Role-aware dashboard (§10.1, §10.2).
 *
 * The warehouseman's version carries quantities only — no monetary values
 * anywhere, and the data for them is never even fetched.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const { t, locale } = await getI18n();
  const actor = { id: user.sub, role: user.role };

  const isDirector = can.seeStockValue(actor);
  const isWarehouse = can.createReceipt(actor);

  const [lowStock, shortfalls, frozen, settings] = await Promise.all([
    getLowStockAlerts(),
    isWarehouse ? getShortfalls() : Promise.resolve([]),
    isDirector ? getFrozenSummary() : Promise.resolve(null),
    getSettings(),
  ]);

  return (
    <>
      <PageHeader title={t("dash.title")} subtitle={t("dash.welcome", { name: user.name })} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("dash.lowStock")}
          value={String(lowStock.length)}
          tone={lowStock.length > 0 ? "warning" : "default"}
          href="/stock?below=1"
        />
        {isWarehouse && (
          <StatTile
            label={t("dash.produceTitle")}
            value={String(shortfalls.length)}
            tone={shortfalls.length > 0 ? "warning" : "default"}
            href="/produce"
          />
        )}
        {frozen && (
          <>
            <StatTile
              label={t("dash.frozenValue")}
              value={formatMoney(frozen.valueAtCostCents, locale)}
              sub={t("dash.frozenCount", { count: frozen.count })}
              tone={frozen.valueAtCostCents > 0 ? "warning" : "default"}
              href="/frozen"
            />
            <StatTile
              label={t("settings.frozenDays")}
              value={`${settings.frozenDays} ${t("common.days")}`}
              sub={t("nav.settings")}
              href="/settings"
            />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* --- Low stock (§4.6) ------------------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle>{t("dash.lowStock")}</CardTitle>
            <Link href="/stock?below=1" className="text-xs text-primary hover:underline">
              {t("common.overview")}
            </Link>
          </CardHeader>
          {lowStock.length === 0 ? (
            <EmptyState title={t("dash.lowStockEmpty")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("product.sku")}</Th>
                  <Th>{t("common.product")}</Th>
                  <Th numeric>{t("stock.available")}</Th>
                  <Th numeric>{t("product.minStock")}</Th>
                </tr>
              </thead>
              <tbody>
                {lowStock.slice(0, 12).map((a) => (
                  <tr key={a.productId}>
                    <Td className="font-mono text-xs">
                      <Link
                        href={`/products/${a.productId}`}
                        className="text-primary hover:underline"
                      >
                        {a.sku}
                      </Link>
                    </Td>
                    <Td>{a.name}</Td>
                    <Td numeric className="font-semibold text-red-600">
                      {a.available}
                    </Td>
                    <Td numeric className="text-muted">
                      {a.minStock}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {/* --- To produce (§7.3) ---------------------------------------- */}
        {isWarehouse && (
          <Card>
            <CardHeader>
              <CardTitle>{t("dash.produceTitle")}</CardTitle>
              <Link href="/produce" className="text-xs text-primary hover:underline">
                {t("common.overview")}
              </Link>
            </CardHeader>
            {shortfalls.length === 0 ? (
              <EmptyState title={t("dash.produceEmpty")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("product.sku")}</Th>
                    <Th>{t("common.product")}</Th>
                    <Th numeric>{t("produce.shortTotal")}</Th>
                    <Th numeric>{t("produce.waitingOrders")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {shortfalls.slice(0, 12).map((s) => (
                    <tr key={s.productId}>
                      <Td className="font-mono text-xs">
                        <Link
                          href={`/products/${s.productId}`}
                          className="text-primary hover:underline"
                        >
                          {s.sku}
                        </Link>
                      </Td>
                      <Td>{s.name}</Td>
                      <Td numeric className="font-semibold text-amber-700">
                        {s.shortTotal}
                      </Td>
                      <Td numeric className="text-muted">
                        {s.orders.length}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
