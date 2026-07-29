import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n";
import { listInProgress, listQueue } from "@/lib/queries/orders";
import { getTopUpAlerts } from "@/lib/orders";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  Td,
  Th,
  PageHeader,
} from "@/components/ui";
import { ORDER_STATUS_COLOR, orderStatusKey } from "@/lib/labels";

/**
 * The warehouseman's order queue (§7.1).
 *
 * Ordered oldest-first because BR-4 makes acceptance order the priority rule:
 * whoever the warehouse accepts first gets the stock, and the Director steers
 * that by telling the warehouse which to take — not by moving reservations.
 *
 * Quantities only; no prices anywhere on this screen.
 */
export default async function QueuePage() {
  const user = await requireRole("DIRECTOR", "WAREHOUSEMAN");
  const { t, locale } = await getI18n();

  const [queue, inProgress, alerts] = await Promise.all([
    listQueue(user.role),
    listInProgress(user.role),
    getTopUpAlerts(),
  ]);

  return (
    <>
      <PageHeader title={t("pick.title")} subtitle={t("pick.subtitle")}>
        {queue.length > 0 && (
          <Badge color="blue">{t("pick.newBadge", { count: queue.length })}</Badge>
        )}
      </PageHeader>

      {/* BR-5: stock arrived for an order that is still short. */}
      {alerts.length > 0 && (
        <div className="mb-5 space-y-2">
          {alerts.slice(0, 6).map((a, i) => (
            <Alert key={`${a.orderId}-${i}`} variant="warning">
              <Link href={`/orders/${a.orderId}`} className="font-medium hover:underline">
                {t("dash.incomingAlert", { product: a.productName, number: a.number })}
              </Link>
            </Alert>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("pick.title")}</CardTitle>
        </CardHeader>
        {queue.length === 0 ? (
          <EmptyState title={t("pick.queueEmpty")} hint={t("pick.queueEmptyHint")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("order.number")}</Th>
                <Th>{t("order.customer")}</Th>
                <Th numeric>{t("order.lineCount")}</Th>
                <Th numeric>{t("pick.totalUnits")}</Th>
                <Th>{t("order.plannedShipDate")}</Th>
                <Th>{t("common.createdAt")}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {queue.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50/60">
                  <Td className="font-mono text-xs whitespace-nowrap">
                    <Link href={`/orders/${o.id}`} className="text-primary hover:underline">
                      {o.number}
                    </Link>
                  </Td>
                  <Td className="font-medium">{o.customerName}</Td>
                  <Td numeric className="text-muted">
                    {o.lineCount}
                  </Td>
                  <Td numeric>{o.totalUnits}</Td>
                  <Td className="whitespace-nowrap text-muted">
                    {formatDate(o.plannedShipDate)}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">
                    {formatDateTime(o.createdAt, locale)}
                  </Td>
                  <Td>
                    <Link
                      href={`/orders/${o.id}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {t("common.open")} →
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>{t("pick.inProgress")}</CardTitle>
        </CardHeader>
        {inProgress.length === 0 ? (
          <EmptyState title={t("common.noResults")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("order.number")}</Th>
                <Th>{t("order.customer")}</Th>
                <Th>{t("common.status")}</Th>
                <Th numeric>{t("order.ordered")}</Th>
                <Th numeric>{t("order.reserved")}</Th>
                <Th numeric>{t("order.shortfall")}</Th>
                <Th>{t("order.plannedShipDate")}</Th>
              </tr>
            </thead>
            <tbody>
              {inProgress.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50/60">
                  <Td className="font-mono text-xs whitespace-nowrap">
                    <Link href={`/orders/${o.id}`} className="text-primary hover:underline">
                      {o.number}
                    </Link>
                  </Td>
                  <Td className="font-medium">{o.customerName}</Td>
                  <Td>
                    <Badge color={ORDER_STATUS_COLOR[o.status]}>
                      {t(orderStatusKey(o.status))}
                    </Badge>
                  </Td>
                  <Td numeric>{o.totalUnits}</Td>
                  <Td numeric className="text-amber-700">
                    {o.reservedUnits}
                  </Td>
                  <Td
                    numeric
                    className={o.shortfallUnits > 0 ? "font-semibold text-red-600" : "text-muted"}
                  >
                    {o.shortfallUnits || ""}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">
                    {formatDate(o.plannedShipDate)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
