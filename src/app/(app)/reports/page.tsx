import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getT } from "@/i18n/server";
import { Card, CardBody, PageHeader } from "@/components/ui";
import type { TranslationKey } from "@/i18n";

/** §10.3 report index. Each entry is gated by the role that may see it. */
const REPORTS: {
  href: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  directorOnly: boolean;
}[] = [
  { href: "/reports/sales", titleKey: "report.sales", descKey: "report.salesDesc", directorOnly: false },
  { href: "/reports/profit", titleKey: "report.profit", descKey: "report.profitDesc", directorOnly: true },
  { href: "/expenses", titleKey: "report.expenses", descKey: "report.expensesDesc", directorOnly: true },
  { href: "/reports/stock-value", titleKey: "report.stockValue", descKey: "report.stockValueDesc", directorOnly: true },
  { href: "/frozen", titleKey: "report.frozen", descKey: "report.frozenDesc", directorOnly: true },
  { href: "/reports/abc", titleKey: "report.abc", descKey: "report.abcDesc", directorOnly: true },
  { href: "/receivables", titleKey: "report.receivables", descKey: "report.receivablesDesc", directorOnly: true },
];

export default async function ReportsPage() {
  const user = await requireRole("DIRECTOR", "SALESPERSON");
  const t = await getT();
  const actor = { id: user.sub, role: user.role };
  const isDirector = can.viewProfit(actor);

  const visible = REPORTS.filter((r) => !r.directorOnly || isDirector);

  return (
    <>
      <PageHeader title={t("report.title")} subtitle={t("report.subtitle")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((r) => (
          <Link key={r.href} href={r.href}>
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardBody>
                <p className="font-semibold">{t(r.titleKey)}</p>
                <p className="mt-1 text-sm text-muted">{t(r.descKey)}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
