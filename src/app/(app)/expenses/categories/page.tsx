import { requireDirector } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { listExpenseCategories } from "@/lib/queries/expenses";
import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { expenseTypeKey } from "@/lib/labels";
import { ExpenseCategoryCreateForm, ExpenseCategoryRow } from "../forms";

/** §9.1 expense categories, each flagged Fixed or Variable for break-even. */
export default async function ExpenseCategoriesPage() {
  await requireDirector();
  const t = await getT();
  const rows = await listExpenseCategories({ includeArchived: true });

  return (
    <>
      <PageHeader title={t("expcat.title")} subtitle={t("expcat.typeHint")} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:order-2">
          <CardHeader>
            <CardTitle>{t("expcat.new")}</CardTitle>
          </CardHeader>
          <ExpenseCategoryCreateForm />
        </Card>

        <Card className="lg:col-span-2 lg:order-1">
          {rows.length === 0 ? (
            <EmptyState title={t("expcat.empty")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("expcat.name")}</Th>
                  <Th>{t("expcat.type")}</Th>
                  <Th numeric>{t("expense.title")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <ExpenseCategoryRow category={c} />
                    </Td>
                    <Td>
                      <Badge color={c.type === "FIXED" ? "indigo" : "slate"}>
                        {t(expenseTypeKey(c.type))}
                      </Badge>
                    </Td>
                    <Td numeric className="text-muted">{c.expenseCount}</Td>
                    <Td>
                      <Badge color={c.active ? "green" : "slate"}>
                        {c.active ? t("common.active") : t("common.archived")}
                      </Badge>
                    </Td>
                    <Td>
                      <ExpenseCategoryRow category={c} actionsOnly />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
