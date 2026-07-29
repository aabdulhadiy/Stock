import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { listExpenses } from "@/lib/queries/expenses";
import { getExpenseTotals } from "@/lib/analytics";
import { exportResponse, parseFormat } from "@/lib/export";
import { resolvePeriod } from "@/lib/dates";
import { expenseTypeKey, paymentMethodKey } from "@/lib/labels";

/** §10.3 report 3: operating expenses by category and period. */
export async function GET(request: Request) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const url = new URL(request.url);
  const p = (key: string) => url.searchParams.get(key) ?? undefined;

  const period = resolvePeriod(p("preset") ?? "this_month", p("from"), p("to"));
  const categoryId = p("category") ?? null;

  const [rows, totals] = await Promise.all([
    listExpenses({ from: period.from, to: period.to, categoryId }),
    getExpenseTotals(period),
  ]);

  return exportResponse(parseFormat(p("format")), {
    filenameBase: `${t("report.expenses")}-${period.from}-${period.to}`,
    title: t("report.expenses"),
    subtitle: t("report.periodLabel", {
      from: formatDate(period.from),
      to: formatDate(period.to),
    }),
    note: t("expense.noDoubleCounting"),
    tables: [
      {
        title: t("expense.byCategory"),
        columns: [
          { header: t("expense.category"), key: "name", weight: 2 },
          { header: t("expcat.type"), key: "type", weight: 1 },
          { header: t("common.amount"), key: "amount", numeric: true, weight: 1.2 },
        ],
        rows: totals.byCategory.map((c) => ({
          name: c.name,
          type: t(expenseTypeKey(c.type)),
          amount: formatMoney(c.amountCents, locale),
        })),
        totals: { name: t("common.total"), amount: formatMoney(totals.totalCents, locale) },
      },
      {
        title: t("expense.title"),
        columns: [
          { header: t("expense.date"), key: "date", weight: 1 },
          { header: t("expense.category"), key: "category", weight: 1.6 },
          { header: t("common.amount"), key: "amount", numeric: true, weight: 1.1 },
          { header: t("expense.method"), key: "method", weight: 1 },
          { header: t("expense.description"), key: "description", weight: 2.4 },
          { header: t("expense.enteredBy"), key: "enteredBy", weight: 1.2 },
        ],
        rows: rows.map((e) => ({
          date: formatDate(e.expenseDate),
          category: e.categoryName,
          amount: formatMoney(e.amountCents, locale),
          method: t(paymentMethodKey(e.method)),
          description: e.description ?? "",
          enteredBy: e.enteredBy ?? "",
        })),
        totals: {
          category: t("common.total"),
          amount: formatMoney(rows.reduce((s, e) => s + e.amountCents, 0), locale),
        },
      },
    ],
  });
}
