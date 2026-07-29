import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { getReceivables } from "@/lib/queries/receivables";
import { exportResponse, parseFormat } from "@/lib/export";
import { AGING_LABEL_KEY, type AgingBucket, today } from "@/lib/dates";
import type { TranslationKey } from "@/i18n";

const BUCKETS: AgingBucket[] = ["CURRENT", "D1_7", "D8_30", "D30_PLUS"];

/** Receivables export with the aging summary (§10.3 report 7). */
export async function GET(request: Request) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const url = new URL(request.url);

  const { rows, totalOutstandingCents, byBucket } = await getReceivables({
    onlyOverdue: url.searchParams.get("overdue") === "1",
  });

  return exportResponse(parseFormat(url.searchParams.get("format")), {
    filenameBase: `${t("recv.title")}-${today()}`,
    title: t("recv.title"),
    subtitle: t("report.generatedAt", { at: formatDate(new Date()) }),
    tables: [
      {
        title: t("recv.aging"),
        columns: [
          { header: t("recv.aging"), key: "bucket", weight: 2 },
          { header: t("order.title"), key: "count", numeric: true, weight: 1 },
          { header: t("order.balance"), key: "amount", numeric: true, weight: 1.4 },
        ],
        rows: BUCKETS.map((bucket) => ({
          bucket: t(AGING_LABEL_KEY[bucket] as TranslationKey),
          count: byBucket[bucket].count,
          amount: formatMoney(byBucket[bucket].amountCents, locale),
        })),
        totals: {
          bucket: t("recv.totalOutstanding"),
          count: rows.length,
          amount: formatMoney(totalOutstandingCents, locale),
        },
      },
      {
        title: t("recv.title"),
        columns: [
          { header: t("order.number"), key: "number", weight: 1.1 },
          { header: t("order.customer"), key: "customer", weight: 2 },
          { header: t("customer.phone"), key: "phone", weight: 1.2 },
          { header: t("order.actualShipDate"), key: "shipDate", weight: 1 },
          { header: t("order.dueDate"), key: "dueDate", weight: 1 },
          { header: t("common.total"), key: "total", numeric: true, weight: 1 },
          { header: t("order.paid"), key: "paid", numeric: true, weight: 1 },
          { header: t("order.balance"), key: "balance", numeric: true, weight: 1 },
          { header: t("order.overdue"), key: "overdue", numeric: true, weight: 0.8 },
          { header: t("recv.aging"), key: "bucket", weight: 1 },
        ],
        rows: rows.map((r) => ({
          number: r.number,
          customer: r.customerName,
          phone: r.customerPhone,
          shipDate: r.actualShipDate ? formatDate(r.actualShipDate) : "",
          dueDate: r.dueDate ? formatDate(r.dueDate) : "",
          total: formatMoney(r.totalCents, locale),
          paid: formatMoney(r.paidCents, locale),
          balance: formatMoney(r.balanceCents, locale),
          overdue: r.overdueDays || "",
          bucket: t(AGING_LABEL_KEY[r.bucket] as TranslationKey),
        })),
        totals: {
          customer: t("recv.totalOutstanding"),
          balance: formatMoney(totalOutstandingCents, locale),
        },
      },
    ],
  });
}
