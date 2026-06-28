"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/app/(app)/actions";
import { roleLabel } from "@/lib/permissions";
import type { Role } from "@/db/schema";

export interface NavItem {
  href: string;
  label: string;
}

export function Sidebar({
  items,
  user,
}: {
  items: NavItem[];
  user: { name: string; role: Role };
}) {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="px-5 py-4 border-b border-border">
        <p className="font-bold leading-tight">Toy Inventory</p>
        <p className="text-xs text-muted">& Sales Platform</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "block rounded-md px-3 py-2 text-sm font-medium",
                active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-slate-100",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border">
        <div className="px-2 mb-2">
          <p className="text-sm font-medium truncate">{user.name}</p>
          <p className="text-xs text-muted">{roleLabel(user.role)}</p>
        </div>
        <form action={logoutAction}>
          <button className="w-full text-left rounded-md px-3 py-2 text-sm text-muted hover:bg-slate-100">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
