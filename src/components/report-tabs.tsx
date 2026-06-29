"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@/db/schema";

const TABS = [
  { href: "/reports/cash", label: "Cash position" },
  { href: "/reports/sales", label: "Sales performance" },
];

export function ReportTabs({ role }: { role: Role }) {
  void role; // both report tabs are available to admins and sales managers
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-border">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
