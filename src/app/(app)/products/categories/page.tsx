import { requireDirector } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { listCategories } from "@/lib/queries/products";
import {
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
import { CategoryCreateForm, CategoryRow } from "./forms";

export default async function CategoriesPage() {
  await requireDirector();
  const t = await getT();
  const rows = await listCategories({ includeArchived: true });

  return (
    <>
      <PageHeader title={t("category.title")} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:order-2">
          <CardHeader>
            <CardTitle>{t("category.new")}</CardTitle>
          </CardHeader>
          <CategoryCreateForm />
        </Card>

        <Card className="lg:col-span-2 lg:order-1">
          {rows.length === 0 ? (
            <EmptyState title={t("category.empty")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("category.name")}</Th>
                  <Th numeric>{t("common.products")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th className="w-40" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <CategoryRow id={c.id} name={c.name} />
                    </Td>
                    <Td numeric className="text-muted">
                      {c.productCount}
                    </Td>
                    <Td>
                      <Badge color={c.active ? "green" : "slate"}>
                        {c.active ? t("common.active") : t("common.archived")}
                      </Badge>
                    </Td>
                    <Td>
                      <CategoryRow id={c.id} name={c.name} active={c.active} actionsOnly />
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
