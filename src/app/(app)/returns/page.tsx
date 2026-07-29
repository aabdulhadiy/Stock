import Link from "next/link";
import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { listReturns } from "@/lib/returns";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Tf,
  Th,
} from "@/components/ui";

/** Return history (§11). */
export default async function ReturnsPage() {
  await requireDirector();
  const { t, locale } = await getI18n();
  const rows = await listReturns();

  return (
    <>
      <PageHeader title={t("return.title")}>
        <Link href="/returns/new">
          <Button size="sm">{t("return.new")}</Button>
        </Link>
      </PageHeader>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title={t("return.empty")}
            action={
              <Link href="/returns/new">
                <Button size="sm">{t("return.new")}</Button>
              </Link>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("return.date")}</Th>
                <Th>{t("return.order")}</Th>
                <Th>{t("order.customer")}</Th>
                <Th numeric>{t("order.lineCount")}</Th>
                <Th numeric>{t("return.qtyReturned")}</Th>
                <Th numeric>{t("return.value")}</Th>
                <Th>{t("common.user")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{formatDate(r.returnDate)}</Td>
                  <Td className="font-mono text-xs">
                    <Link href={`/orders/${r.orderId}`} className="text-primary hover:underline">
                      {r.orderNumber}
                    </Link>
                  </Td>
                  <Td className="font-medium">{r.customerName}</Td>
                  <Td numeric className="text-muted">{r.lineCount}</Td>
                  <Td numeric>{r.unitsReturned}</Td>
                  <Td numeric className="font-medium">{formatMoney(r.creditCents, locale)}</Td>
                  <Td className="text-muted">{r.userName ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Tf colSpan={4}>{t("common.total")}</Tf>
                <Tf numeric>{rows.reduce((s, r) => s + r.unitsReturned, 0)}</Tf>
                <Tf numeric>
                  {formatMoney(rows.reduce((s, r) => s + r.creditCents, 0), locale)}
                </Tf>
                <Tf />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
