import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatMoney } from "@/i18n";
import { listExpenseCategories, listRecurringExpenses } from "@/lib/queries/expenses";
import { monthKey, today } from "@/lib/dates";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Tf,
  Th,
} from "@/components/ui";
import { expenseTypeKey, paymentMethodKey } from "@/lib/labels";
import {
  DeleteRecurringButton,
  GenerateRecurringButton,
  RecurringCreateForm,
} from "../forms";

/** §9.3 recurring monthly expense templates, generated on demand. */
export default async function RecurringExpensesPage() {
  await requireDirector();
  const { t, locale } = await getI18n();

  const [templates, categories] = await Promise.all([
    listRecurringExpenses(),
    listExpenseCategories(),
  ]);

  const active = templates.filter((r) => r.active);
  const totalCents = active.reduce((s, r) => s + r.amountCents, 0);

  return (
    <>
      <PageHeader title={t("recur.title")} subtitle={t("recur.subtitle")} />

      <Card className="mb-5">
        <CardBody>
          <GenerateRecurringButton
            month={monthKey(today())}
            templateCount={active.length}
            totalCents={totalCents}
          />
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:order-2">
          <CardHeader>
            <CardTitle>{t("recur.new")}</CardTitle>
          </CardHeader>
          <RecurringCreateForm categories={categories} />
        </Card>

        <Card className="lg:col-span-2 lg:order-1">
          {templates.length === 0 ? (
            <EmptyState title={t("recur.empty")} hint={t("recur.subtitle")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("expense.category")}</Th>
                  <Th>{t("expcat.type")}</Th>
                  <Th numeric>{t("expense.amount")}</Th>
                  <Th>{t("expense.method")}</Th>
                  <Th>{t("expense.description")}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {templates.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.categoryName}</Td>
                    <Td>
                      <Badge color={r.categoryType === "FIXED" ? "indigo" : "slate"}>
                        {t(expenseTypeKey(r.categoryType))}
                      </Badge>
                    </Td>
                    <Td numeric className="font-medium">{formatMoney(r.amountCents, locale)}</Td>
                    <Td className="text-muted">{t(paymentMethodKey(r.method))}</Td>
                    <Td className="text-muted">{r.description ?? ""}</Td>
                    <Td>
                      <DeleteRecurringButton id={r.id} />
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <Tf colSpan={2}>{t("common.total")}</Tf>
                  <Tf numeric>{formatMoney(totalCents, locale)}</Tf>
                  <Tf colSpan={3} />
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
