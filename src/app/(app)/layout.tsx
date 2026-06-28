import { requireUser } from "@/lib/auth";
import { Sidebar, type NavItem } from "@/components/nav";
import { SECTION_ROLES } from "@/lib/permissions";
import type { Role } from "@/db/schema";

const ALL_ITEMS: (NavItem & { roles: Role[] })[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["ADMIN", "WAREHOUSE", "SALES_MANAGER"] },
  { href: "/products", label: "Products", roles: SECTION_ROLES["/products"] },
  { href: "/stock", label: "Stock", roles: SECTION_ROLES["/stock"] },
  { href: "/admin/users", label: "Users", roles: ["ADMIN"] },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const items = ALL_ITEMS.filter((i) => i.roles.includes(user.role)).map(
    ({ href, label }) => ({ href, label }),
  );

  return (
    <div className="flex min-h-screen">
      <Sidebar items={items} user={{ name: user.name, role: user.role }} />
      <main className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
