import Link from "next/link";
import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { getReceivables } from "@/lib/queries/receivables";
import { AGING_LABEL_KEY, type AgingBucket } from "@/lib/dates";
import type { TranslationKey } from "@/i18n";
import {
  Badge,
  Card,
  EmptyState,
  StatTile,
  Table,
  Td,
  Tf,
  Th,
  Toolbar,
  PageHeader,
} from "@/components/ui";
import {
  CheckboxField,
  ExportButtons,
  FilterForm,
  type Query,
} from "@/components/table-tools";

const BUCKETS: AgingBucket[] = ["CURRENT", "D1_7", "D8_30", "D30_PLUS"];

const BUCKET_COLOR: Record<AgingBucket, "green" | "amber" | "red" | "slate"> = {
  CURRENT: "green",
  D1_7: "amber",
  D8_30: "red",
  D30_PLUS: "red",
};

/** §10.3 report 7: debtors with aging buckets. */
export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const params = await searchParams;

  const query: Query = { overdue: params.overdue };
  const { rows, totalOutstandingCents, byBucket } = await getReceivables({
    onlyOverdue: params.overdue === "1",
  });

  return (
    <>
      <PageHeader title={t("recv.title")} subtitle={t("recv.subtitle")}>
        <ExportButtons t={t} href="/export/receivables" query={query} />
      </PageHeader>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label={t("recv.totalOutstanding")}
          value={formatMoney(totalOutstandingCents, locale)}
          tone={totalOutstandingCents > 0 ? "warning" : "default"}
        />
        {BUCKETS.map((bucket) => (
          <StatTile
            key={bucket}
            label={t(AGING_LABEL_KEY[bucket] as TranslationKey)}
            value={formatMoney(byBucket[bucket].amountCents, locale)}
            sub={`${byBucket[bucket].count} ${t("order.title").toLowerCase()}`}
            tone={
              bucket === "CURRENT"
                ? "default"
                : bucket === "D1_7"
                  ? "warning"
                  : "negative"
            }
          />
        ))}
      </div>

      <Card>
        <Toolbar>
          <FilterForm action="/receivables" t={t}>
            <CheckboxField
              label={t("recv.onlyOverdue")}
              name="overdue"
              defaultChecked={params.overdue === "1"}
            />
          </FilterForm>
        </Toolbar>

        {rows.length === 0 ? (
          <EmptyState title={t("recv.empty")} hint={t("recv.emptyHint")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("order.number")}</Th>
                <Th>{t("order.customer")}</Th>
                <Th>{t("customer.phone")}</Th>
                <Th>{t("order.actualShipDate")}</Th>
                <Th>{t("order.dueDate")}</Th>
                <Th numeric>{t("common.total")}</Th>
                <Th numeric>{t("order.paid")}</Th>
                <Th numeric>{t("order.balance")}</Th>
                <Th numeric>{t("order.overdue")}</Th>
                <Th>{t("recv.aging")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.orderId}
                  // §5.4: overdue orders are highlighted red.
                  className={r.overdueDays > 0 ? "bg-red-50/70" : undefined}
                >
                  <Td className="font-mono text-xs whitespace-nowrap">
                    <Link href={`/orders/${r.orderId}`} className="text-primary hover:underline">
                      {r.number}
                    </Link>
                  </Td>
                  <Td className="font-medium">
                    <Link href={`/customers/${r.customerId}`} className="hover:underline">
                      {r.customerName}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{r.customerPhone}</Td>
                  <Td className="whitespace-nowrap text-muted">
                    {r.actualShipDate ? formatDate(r.actualShipDate) : "—"}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {r.dueDate ? formatDate(r.dueDate) : "—"}
                  </Td>
                  <Td numeric>{formatMoney(r.totalCents, locale)}</Td>
                  <Td numeric className="text-muted">
                    {formatMoney(r.paidCents, locale)}
                    {r.returnedCents > 0 && (
                      <span className="block text-xs">
                        −{formatMoney(r.returnedCents, locale)} {t("nav.returns").toLowerCase()}
                      </span>
                    )}
                  </Td>
                  <Td numeric className="font-semibold text-red-600">
                    {formatMoney(r.balanceCents, locale)}
                  </Td>
                  <Td numeric className={r.overdueDays > 0 ? "font-medium text-red-600" : "text-muted"}>
                    {r.overdueDays > 0 ? `${r.overdueDays} ${t("common.days")}` : "—"}
                  </Td>
                  <Td>
                    <Badge color={BUCKET_COLOR[r.bucket]}>
                      {t(AGING_LABEL_KEY[r.bucket] as TranslationKey)}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Tf colSpan={7}>{t("recv.totalOutstanding")}</Tf>
                <Tf numeric>{formatMoney(totalOutstandingCents, locale)}</Tf>
                <Tf colSpan={2} />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
