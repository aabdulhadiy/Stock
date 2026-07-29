import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { getShortfalls } from "@/lib/stock";
import {
  Badge,
  Card,
  EmptyState,
  Table,
  Td,
  Th,
  Tf,
  PageHeader,
} from "@/components/ui";

/**
 * §7.3 consolidated "to produce" list: every unfilled shortfall across accepted
 * orders, with the orders that are waiting. Quantities only — visible to the
 * Director and the warehouseman.
 */
export default async function ProducePage() {
  await requireRole("DIRECTOR", "WAREHOUSEMAN");
  const t = await getT();
  const rows = await getShortfalls();

  return (
    <>
      <PageHeader title={t("produce.title")} subtitle={t("produce.subtitle")} />

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t("produce.empty")} hint={t("produce.emptyHint")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("product.sku")}</Th>
                <Th>{t("common.product")}</Th>
                <Th numeric>{t("produce.shortTotal")}</Th>
                <Th>{t("produce.waitingOrders")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId}>
                  <Td className="font-mono text-xs whitespace-nowrap">
                    <Link
                      href={`/products/${r.productId}`}
                      className="text-primary hover:underline"
                    >
                      {r.sku}
                    </Link>
                  </Td>
                  <Td className="font-medium">{r.name}</Td>
                  <Td numeric className="font-semibold text-amber-700">
                    {r.shortTotal}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {r.orders.map((o) => (
                        <Link key={o.id} href={`/orders/${o.id}`}>
                          <Badge color="amber">
                            {o.number} · {o.short}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Tf colSpan={2}>{t("common.total")}</Tf>
                <Tf numeric>{rows.reduce((s, r) => s + r.shortTotal, 0)}</Tf>
                <Tf />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
