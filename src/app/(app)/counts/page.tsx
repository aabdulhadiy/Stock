import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryCounts, users } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n";
import { sql } from "drizzle-orm";
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
import { COUNT_STATUS_COLOR, countStatusKey } from "@/lib/labels";
import { today } from "@/lib/dates";
import { NewCountForm } from "./forms";

/** §4.5 inventory count list. */
export default async function CountsPage() {
  await requireRole("DIRECTOR", "WAREHOUSEMAN");
  const t = await getT();

  const rows = await db
    .select({
      id: inventoryCounts.id,
      countDate: inventoryCounts.countDate,
      status: inventoryCounts.status,
      performedBy: users.name,
      approvedAt: inventoryCounts.approvedAt,
      lineCount: sql<number>`(
        SELECT COUNT(*) FROM inventory_count_items ici
         WHERE ici.count_id = "inventory_counts"."id"
      )`,
      varianceLines: sql<number>`(
        SELECT COUNT(*) FROM inventory_count_items ici
         WHERE ici.count_id = "inventory_counts"."id" AND ici.variance <> 0
      )`,
      netVariance: sql<number>`COALESCE((
        SELECT SUM(ici.variance) FROM inventory_count_items ici
         WHERE ici.count_id = "inventory_counts"."id"
      ), 0)`,
    })
    .from(inventoryCounts)
    .leftJoin(users, eq(users.id, inventoryCounts.userId))
    .orderBy(desc(inventoryCounts.countDate), desc(inventoryCounts.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader title={t("count.title")} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:order-2">
          <CardHeader>
            <CardTitle>{t("count.new")}</CardTitle>
          </CardHeader>
          <NewCountForm today={today()} />
        </Card>

        <Card className="lg:col-span-2 lg:order-1">
          {rows.length === 0 ? (
            <EmptyState title={t("count.empty")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("count.date")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th>{t("count.performedBy")}</Th>
                  <Th numeric>{t("order.lineCount")}</Th>
                  <Th numeric>{t("count.variance")}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <Td className="whitespace-nowrap font-medium">
                      <Link href={`/counts/${c.id}`} className="text-primary hover:underline">
                        {formatDate(c.countDate)}
                      </Link>
                    </Td>
                    <Td>
                      <Badge color={COUNT_STATUS_COLOR[c.status]}>
                        {t(countStatusKey(c.status))}
                      </Badge>
                    </Td>
                    <Td className="text-muted">{c.performedBy ?? "—"}</Td>
                    <Td numeric>{Number(c.lineCount)}</Td>
                    <Td numeric>
                      {Number(c.varianceLines) === 0 ? (
                        <span className="text-muted">{t("count.noVariance")}</span>
                      ) : (
                        <span className="font-medium text-amber-700">
                          {t("count.varianceSummary", {
                            lines: Number(c.varianceLines),
                            net: Number(c.netVariance),
                          })}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Link
                        href={`/counts/${c.id}`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {t("common.open")} →
                      </Link>
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
