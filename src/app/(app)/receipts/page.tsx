import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { products, stockMovements, users } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n";
import { listProductOptions } from "@/lib/queries/products";
import { today } from "@/lib/dates";
import {
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  Td,
  Th,
  PageHeader,
} from "@/components/ui";
import { ReceiptForm } from "@/components/receipt-form";

export default async function ReceiptsPage() {
  const user = await requireRole("DIRECTOR", "WAREHOUSEMAN");
  const t = await getT();

  const [options, history] = await Promise.all([
    listProductOptions(user.role),
    db
      .select({
        id: stockMovements.id,
        qtyUnits: stockMovements.qtyUnits,
        movementDate: stockMovements.movementDate,
        createdAt: stockMovements.createdAt,
        note: stockMovements.note,
        sku: products.sku,
        name: products.name,
        userName: users.name,
      })
      .from(stockMovements)
      .innerJoin(products, eq(products.id, stockMovements.productId))
      .leftJoin(users, eq(users.id, stockMovements.userId))
      .where(eq(stockMovements.type, "RECEIPT"))
      .orderBy(desc(stockMovements.movementDate), desc(stockMovements.createdAt))
      .limit(100),
  ]);

  return (
    <>
      <PageHeader title={t("receipt.title")} />

      <ReceiptForm products={options} today={today()} />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("receipt.history")}</CardTitle>
        </CardHeader>
        {history.length === 0 ? (
          <EmptyState title={t("receipt.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("receipt.date")}</Th>
                <Th>{t("product.sku")}</Th>
                <Th>{t("common.product")}</Th>
                <Th numeric>{t("common.quantity")}</Th>
                <Th>{t("common.user")}</Th>
                <Th>{t("common.note")}</Th>
                <Th>{t("common.createdAt")}</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{formatDate(r.movementDate)}</Td>
                  <Td className="font-mono text-xs">{r.sku}</Td>
                  <Td>{r.name}</Td>
                  <Td numeric className="font-medium text-emerald-700">
                    +{r.qtyUnits}
                  </Td>
                  <Td className="text-muted">{r.userName ?? "—"}</Td>
                  <Td className="text-muted">{r.note ?? ""}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">
                    {formatDateTime(r.createdAt)}
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
