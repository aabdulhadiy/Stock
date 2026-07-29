import Link from "next/link";
import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney, formatPercent } from "@/i18n";
import { listExpenseCategories, listExpenses } from "@/lib/queries/expenses";
import { getExpenseTotals, getSalesTotals } from "@/lib/analytics";
import { resolvePeriod, today, PERIOD_PRESETS, PERIOD_LABEL_KEY } from "@/lib/dates";
import type { TranslationKey } from "@/i18n";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  StatTile,
  Table,
  Td,
  Tf,
  Th,
  Thumb,
  Toolbar,
  PageHeader,
} from "@/components/ui";
import {
  ExportButtons,
  FilterForm,
  SelectField,
  type Query,
} from "@/components/table-tools";
import { expenseTypeKey, paymentMethodKey } from "@/lib/labels";
import { ExpenseForm, DeleteExpenseButton } from "./forms";

/** Expense register with the §9.4 monthly summary. */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const params = await searchParams;

  const period = resolvePeriod(params.preset ?? "this_month", params.from, params.to);
  const query: Query = {
    preset: params.preset,
    from: params.from,
    to: params.to,
    category: params.category,
  };

  const [rows, categories, totals, sales] = await Promise.all([
    listExpenses({
      from: period.from,
      to: period.to,
      categoryId: params.category ?? null,
    }),
    listExpenseCategories({ includeArchived: true }),
    getExpenseTotals(period),
    getSalesTotals(period),
  ]);

  const activeCategories = categories.filter((c) => c.active);

  return (
    <>
      <PageHeader title={t("expense.title")} subtitle={t("expense.emptyHint")}>
        <Link href="/expenses/categories">
          <Button variant="secondary" size="sm">
            {t("expcat.title")}
          </Button>
        </Link>
        <Link href="/expenses/recurring">
          <Button variant="secondary" size="sm">
            {t("recur.title")}
          </Button>
        </Link>
        <ExportButtons t={t} href="/export/expenses" query={query} />
      </PageHeader>

      <div className="mb-5">
        <Alert variant="info">{t("expense.noDoubleCounting")}</Alert>
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("expense.monthlyTotal")}
          value={formatMoney(totals.totalCents, locale)}
        />
        <StatTile
          label={t("expcat.type.FIXED")}
          value={formatMoney(totals.fixedCents, locale)}
          sub={t("expcat.typeHint")}
        />
        <StatTile
          label={t("expcat.type.VARIABLE")}
          value={formatMoney(totals.variableCents, locale)}
        />
        <StatTile
          label={t("expense.pctOfRevenue")}
          value={formatPercent(
            sales.revenueCents > 0 ? totals.totalCents / sales.revenueCents : null,
            locale,
          )}
          sub={formatMoney(sales.revenueCents, locale)}
          tone={
            sales.revenueCents > 0 && totals.totalCents > sales.revenueCents
              ? "negative"
              : "default"
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          {activeCategories.length === 0 ? (
            <Alert variant="warning">{t("expcat.empty")}</Alert>
          ) : (
            <ExpenseForm categories={activeCategories} today={today()} />
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t("expense.byCategory")}</CardTitle>
            </CardHeader>
            {totals.byCategory.length === 0 ? (
              <EmptyState title={t("report.empty")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("expense.category")}</Th>
                    <Th>{t("expcat.type")}</Th>
                    <Th numeric>{t("common.amount")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {totals.byCategory.map((c) => (
                    <tr key={c.categoryId}>
                      <Td className="font-medium">{c.name}</Td>
                      <Td>
                        <Badge color={c.type === "FIXED" ? "indigo" : "slate"}>
                          {t(expenseTypeKey(c.type))}
                        </Badge>
                      </Td>
                      <Td numeric>{formatMoney(c.amountCents, locale)}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <Tf colSpan={2}>{t("common.total")}</Tf>
                    <Tf numeric>{formatMoney(totals.totalCents, locale)}</Tf>
                  </tr>
                </tfoot>
              </Table>
            )}
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <Toolbar>
            <FilterForm action="/expenses" t={t}>
              <SelectField
                label={t("common.period")}
                name="preset"
                defaultValue={params.preset ?? "this_month"}
                options={PERIOD_PRESETS.map((p) => ({
                  value: p,
                  label: t(PERIOD_LABEL_KEY[p] as TranslationKey),
                }))}
              />
              <SelectField
                label={t("expense.category")}
                name="category"
                defaultValue={params.category ?? ""}
                options={[
                  { value: "", label: t("common.all") },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </FilterForm>
          </Toolbar>

          {rows.length === 0 ? (
            <EmptyState title={t("expense.empty")} hint={t("expense.emptyHint")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("expense.date")}</Th>
                  <Th>{t("expense.category")}</Th>
                  <Th numeric>{t("common.amount")}</Th>
                  <Th>{t("expense.method")}</Th>
                  <Th>{t("expense.description")}</Th>
                  <Th>{t("expense.receipt")}</Th>
                  <Th>{t("expense.enteredBy")}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap">{formatDate(e.expenseDate)}</Td>
                    <Td>
                      {e.categoryName}
                      <Badge
                        color={e.categoryType === "FIXED" ? "indigo" : "slate"}
                        className="ml-2"
                      >
                        {t(expenseTypeKey(e.categoryType))}
                      </Badge>
                    </Td>
                    <Td numeric className="font-medium">
                      {formatMoney(e.amountCents, locale)}
                    </Td>
                    <Td className="text-muted">{t(paymentMethodKey(e.method))}</Td>
                    <Td className="text-muted">{e.description ?? ""}</Td>
                    <Td>
                      {e.receiptImageUrl ? (
                        <a href={e.receiptImageUrl} target="_blank" rel="noreferrer">
                          <Thumb src={e.receiptImageUrl} alt={t("expense.receipt")} size={28} />
                        </a>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </Td>
                    <Td className="text-muted">{e.enteredBy ?? "—"}</Td>
                    <Td>
                      <DeleteExpenseButton id={e.id} />
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <Tf colSpan={2}>{t("common.total")}</Tf>
                  <Tf numeric>
                    {formatMoney(
                      rows.reduce((s, e) => s + e.amountCents, 0),
                      locale,
                    )}
                  </Tf>
                  <Tf colSpan={5} />
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
