import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isPathAllowed } from "@/lib/permissions";
import { AppShell, type NavGroup } from "@/components/nav";
import { roleKey } from "@/lib/labels";
import type { Role } from "@/db/schema";
import type { TranslationKey } from "@/i18n";

/** Nav definition, filtered per role by the §2.2 section map. */
const GROUPS: { titleKey?: TranslationKey; items: { href: string; labelKey: TranslationKey }[] }[] = [
  { items: [{ href: "/dashboard", labelKey: "nav.dashboard" }] },
  {
    titleKey: "nav.sales",
    items: [
      { href: "/orders", labelKey: "nav.orders" },
      { href: "/queue", labelKey: "nav.queue" },
      { href: "/customers", labelKey: "nav.customers" },
    ],
  },
  {
    titleKey: "nav.warehouse",
    items: [
      { href: "/stock", labelKey: "nav.stock" },
      { href: "/products", labelKey: "nav.products" },
      { href: "/receipts", labelKey: "nav.receipts" },
      { href: "/produce", labelKey: "nav.produce" },
      { href: "/counts", labelKey: "nav.counts" },
      { href: "/frozen", labelKey: "nav.frozen" },
    ],
  },
  {
    titleKey: "nav.money",
    items: [
      { href: "/receivables", labelKey: "nav.receivables" },
      { href: "/returns", labelKey: "nav.returns" },
      { href: "/expenses", labelKey: "nav.expenses" },
    ],
  },
  {
    titleKey: "nav.analytics",
    items: [{ href: "/reports", labelKey: "nav.reports" }],
  },
  {
    titleKey: "nav.admin",
    items: [
      { href: "/admin/users", labelKey: "nav.users" },
      { href: "/settings", labelKey: "nav.settings" },
      { href: "/audit", labelKey: "nav.audit" },
    ],
  },
];

function navForRole(role: Role): NavGroup[] {
  return GROUPS.map((group) => ({
    titleKey: group.titleKey,
    // Copy each item: GROUPS is module-level, and the badge below is per-request.
    items: group.items
      .filter((item) => isPathAllowed(item.href, role))
      .map((item) => ({ ...item })),
  })).filter((group) => group.items.length > 0);
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const groups = navForRole(user.role);

  // Badge the order queue with the count of orders awaiting acceptance (§7.1).
  if (groups.some((g) => g.items.some((i) => i.href === "/queue"))) {
    const [row] = await db
      .select({ n: count() })
      .from(orders)
      .where(eq(orders.status, "NEW"));
    const pending = Number(row?.n ?? 0);
    if (pending > 0) {
      for (const group of groups) {
        const item = group.items.find((i) => i.href === "/queue");
        if (item) item.badge = pending;
      }
    }
  }

  return (
    <AppShell
      groups={groups}
      user={{ name: user.name, roleKey: roleKey(user.role) }}
    >
      {children}
    </AppShell>
  );
}
