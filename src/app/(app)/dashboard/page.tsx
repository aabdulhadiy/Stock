import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatMoney, formatMoneyShort, formatPercent } from "@/i18n";
import { getFrozenSummary, getLowStockAlerts } from "@/lib/queries/products";
import { getShortfalls } from "@/lib/stock";
import { getTopUpAlerts } from "@/lib/orders";
import { countOrdersByStatus, listOrders, listQueue } from "@/lib/queries/orders";
import { getReceivablesTotals } from "@/lib/queries/receivables";
import { getDirectorDashboard } from "@/lib/analytics";
import { getSettings } from "@/lib/settings";
import type { OrderStatus } from "@/db/schema";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DetailRow,
  EmptyState,
  Progress,
  StatTile,
  Table,
  Td,
  Th,
  PageHeader,
} from "@/components/ui";
import { ORDER_STATUS_COLOR, orderStatusKey } from "@/lib/labels";

const STATUSES: OrderStatus[] = ["NEW", "PICKING", "READY", "SHIPPED", "CANCELLED"];

/**
 * Role-aware dashboard (§10.1, §10.2).
 *
 * The warehouseman's version carries quantities only — and the monetary data is
 * never even fetched for them, so there is nothing to leak into the payload.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const { t, locale } = await getI18n();
  const actor = { id: user.sub, role: user.role };

  const isDirector = can.viewProfit(actor);
  const isWarehouse = can.createReceipt(actor);
  const seesOrders = can.viewAllOrders(actor);

  const [
    lowStock,
    shortfalls,
    topUps,
    queue,
    statusCounts,
    frozen,
    receivables,
    director,
    settings,
  ] = await Promise.all([
    getLowStockAlerts(),
    isWarehouse ? getShortfalls() : Promise.resolve([]),
    isWarehouse ? getTopUpAlerts() : Promise.resolve([]),
    isWarehouse ? listQueue(user.role) : Promise.resolve([]),
    seesOrders ? countOrdersByStatus() : Promise.resolve(null),
    isDirector ? getFrozenSummary() : Promise.resolve(null),
    isDirector ? getReceivablesTotals() : Promise.resolve(null),
    isDirector ? getDirectorDashboard() : Promise.resolve(null),
    getSettings(),
  ]);

  const lateOrders = isDirector
    ? (await listOrders(user.role, { onlyLate: true, pageSize: 8 })).rows
    : [];

  return (
    <>
      <PageHeader title={t("dash.title")} subtitle={t("dash.welcome", { name: user.name })} />

      {/* --- Tiles ---------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {director && (
          <>
            <StatTile
              label={t("dash.salesToday")}
              value={formatMoney(director.salesTodayCents, locale)}
            />
            <StatTile
              label={t("dash.salesMonth")}
              value={formatMoney(director.salesMonthCents, locale)}
              sub={director.monthLabel}
            />
          </>
        )}
        {receivables && (
          <StatTile
            label={t("dash.receivablesTotal")}
            value={formatMoney(receivables.outstandingCents, locale)}
            sub={
              receivables.overdueCount > 0
                ? `${t("dash.overdueTotal")}: ${formatMoney(receivables.overdueCents, locale)}`
                : undefined
            }
            tone={receivables.overdueCents > 0 ? "negative" : "default"}
            href="/receivables"
          />
        )}
        {frozen && (
          <StatTile
            label={t("dash.frozenValue")}
            value={formatMoney(frozen.valueAtCostCents, locale)}
            sub={t("dash.frozenCount", { count: frozen.count })}
            tone={frozen.valueAtCostCents > 0 ? "warning" : "default"}
            href="/frozen"
          />
        )}
        <StatTile
          label={t("dash.lowStock")}
          value={String(lowStock.length)}
          tone={lowStock.length > 0 ? "warning" : "default"}
          href="/stock?below=1"
        />
        {isWarehouse && (
          <>
            <StatTile
              label={t("dash.queueTitle")}
              value={String(queue.length)}
              tone={queue.length > 0 ? "warning" : "default"}
              href="/queue"
            />
            <StatTile
              label={t("dash.produceTitle")}
              value={String(shortfalls.length)}
              tone={shortfalls.length > 0 ? "warning" : "default"}
              href="/produce"
            />
          </>
        )}
      </div>

      {/* --- BR-5 top-up alerts -------------------------------------- */}
      {topUps.length > 0 && (
        <div className="mt-5 space-y-2">
          {topUps.slice(0, 4).map((a, i) => (
            <Alert key={`${a.orderId}-${i}`} variant="warning">
              <Link href={`/orders/${a.orderId}`} className="font-medium hover:underline">
                {t("dash.incomingAlert", { product: a.productName, number: a.number })}
              </Link>
            </Alert>
          ))}
        </div>
      )}

      {/* --- P&L and break-even (§9.4, §10.1) ------------------------ */}
      {director && (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("dash.pnlTitle")}</CardTitle>
              <span className="text-xs text-muted">{director.monthLabel}</span>
            </CardHeader>
            <CardBody>
              <dl>
                <DetailRow label={t("dash.revenue")}>
                  {formatMoney(director.pnl.revenueCents, locale)}
                </DetailRow>
                <DetailRow label={t("dash.cogs")}>
                  −{formatMoney(director.pnl.cogsCents, locale)}
                </DetailRow>
                <DetailRow label={t("dash.grossProfit")}>
                  <span className="font-semibold">
                    {formatMoney(director.pnl.grossProfitCents, locale)}
                  </span>
                  <span className="ml-2 text-xs font-normal text-muted">
                    {formatPercent(director.pnl.grossMargin, locale)}
                  </span>
                </DetailRow>
                <DetailRow label={t("dash.operatingExpenses")}>
                  −{formatMoney(director.pnl.operatingExpensesCents, locale)}
                </DetailRow>
                <DetailRow label={t("dash.operatingProfit")}>
                  <span
                    className={
                      director.pnl.operatingProfitCents >= 0
                        ? "text-base font-bold text-emerald-700"
                        : "text-base font-bold text-red-600"
                    }
                  >
                    {formatMoney(director.pnl.operatingProfitCents, locale)}
                  </span>
                </DetailRow>
                <DetailRow label={t("dash.expensesPctRevenue")}>
                  {formatPercent(director.pnl.expenseRatio, locale)}
                </DetailRow>
              </dl>
              <Link
                href="/reports/profit"
                className="mt-3 inline-block text-sm text-primary hover:underline"
              >
                {t("report.profit")} →
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("dash.breakEvenTitle")}</CardTitle>
            </CardHeader>
            <CardBody>
              {director.pnl.breakEvenRevenueCents === null ? (
                <Alert variant="info">{t("dash.breakEvenUnknown")}</Alert>
              ) : (
                <>
                  <Progress
                    ratio={director.pnl.breakEvenProgress ?? 0}
                    tone={
                      (director.pnl.breakEvenProgress ?? 0) >= 1 ? "success" : "warning"
                    }
                    label={
                      (director.pnl.breakEvenProgress ?? 0) >= 1
                        ? t("dash.breakEvenReached")
                        : t("dash.breakEvenRemaining", {
                            amount: formatMoney(
                              director.pnl.breakEvenRevenueCents -
                                director.pnl.revenueCents,
                              locale,
                            ),
                          })
                    }
                  />
                  <dl className="mt-4">
                    <DetailRow label={t("dash.breakEvenTarget")}>
                      {formatMoney(director.pnl.breakEvenRevenueCents, locale)}
                    </DetailRow>
                    <DetailRow label={t("dash.revenue")}>
                      {formatMoney(director.pnl.revenueCents, locale)}
                    </DetailRow>
                    <DetailRow label={t("expcat.type.FIXED")}>
                      {formatMoney(director.pnl.fixedExpensesCents, locale)}
                    </DetailRow>
                    <DetailRow label={t("dash.grossMargin")}>
                      {formatPercent(director.pnl.grossMargin, locale)}
                    </DetailRow>
                  </dl>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* --- Orders by status ---------------------------------------- */}
      {statusCounts && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("dash.ordersByStatus")}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-3">
            {STATUSES.map((status) => (
              <Link key={status} href={`/orders?status=${status}`}>
                <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-slate-50">
                  <Badge color={ORDER_STATUS_COLOR[status]}>{t(orderStatusKey(status))}</Badge>
                  <span className="font-semibold tabular-nums">{statusCounts[status]}</span>
                </span>
              </Link>
            ))}
          </CardBody>
        </Card>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* --- Low stock (§4.6) -------------------------------------- */}
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
                {lowStock.slice(0, 10).map((a) => (
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

        {/* --- To produce (§7.3) ------------------------------------- */}
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
                  {shortfalls.slice(0, 10).map((s) => (
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

        {/* --- Late shipments (§5.5) --------------------------------- */}
        {isDirector && (
          <Card>
            <CardHeader>
              <CardTitle>{t("dash.lateOrders")}</CardTitle>
              <Link href="/orders?late=1" className="text-xs text-primary hover:underline">
                {t("common.overview")}
              </Link>
            </CardHeader>
            {lateOrders.length === 0 ? (
              <EmptyState title={t("order.onTime")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("order.number")}</Th>
                    <Th>{t("order.customer")}</Th>
                    <Th numeric>{t("common.total")}</Th>
                    <Th numeric>{t("order.deadline")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {lateOrders.map((o) => (
                    <tr key={o.id}>
                      <Td className="font-mono text-xs">
                        <Link href={`/orders/${o.id}`} className="text-primary hover:underline">
                          {o.number}
                        </Link>
                      </Td>
                      <Td>{o.customerName}</Td>
                      <Td numeric>{formatMoneyShort(o.totalCents ?? 0, locale)}</Td>
                      <Td numeric className="text-red-600">
                        {t("order.lateBy", { days: o.shipDelayDays ?? 0 })}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}

        {/* --- Warehouse queue (§10.2) ------------------------------- */}
        {isWarehouse && (
          <Card>
            <CardHeader>
              <CardTitle>{t("dash.queueTitle")}</CardTitle>
              <Link href="/queue" className="text-xs text-primary hover:underline">
                {t("common.overview")}
              </Link>
            </CardHeader>
            {queue.length === 0 ? (
              <EmptyState title={t("dash.queueEmpty")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("order.number")}</Th>
                    <Th>{t("order.customer")}</Th>
                    <Th numeric>{t("pick.totalUnits")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {queue.slice(0, 10).map((o) => (
                    <tr key={o.id}>
                      <Td className="font-mono text-xs">
                        <Link href={`/orders/${o.id}`} className="text-primary hover:underline">
                          {o.number}
                        </Link>
                      </Td>
                      <Td>{o.customerName}</Td>
                      <Td numeric>{o.totalUnits}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </div>

      {isDirector && (
        <p className="mt-6 text-xs text-muted">
          {t("settings.frozenDays")}: {settings.frozenDays} · {t("settings.slowDays")}:{" "}
          {settings.slowDays}
        </p>
      )}
    </>
  );
}
