"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/app/(app)/actions";
import { useT } from "@/i18n/client";
import type { TranslationKey } from "@/i18n";
import { LocaleSwitcher } from "@/components/locale-switcher";

export interface NavItem {
  href: string;
  labelKey: TranslationKey;
  /** Count badge, e.g. new orders waiting in the queue (§7.1). */
  badge?: number;
}

export interface NavGroup {
  titleKey?: TranslationKey;
  items: NavItem[];
}

/**
 * App shell navigation. Items arrive already filtered by role from the layout;
 * labels are translation *keys* so the sidebar re-renders in the new language
 * the moment the switcher changes the cookie.
 *
 * §14: the warehouseman may work from a phone, so the sidebar collapses behind
 * a toggle below `lg` and closes itself on navigation.
 */
export function AppShell({
  groups,
  user,
  children,
}: {
  groups: NavGroup[];
  user: { name: string; roleKey: TranslationKey };
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Close the drawer whenever the route changes.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen lg:flex">
      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="app-sidebar"
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-slate-100"
        >
          <span aria-hidden className="text-lg leading-none">
            {open ? "✕" : "☰"}
          </span>
          {t("app.name")}
        </button>
        <LocaleSwitcher />
      </div>

      <aside
        id="app-sidebar"
        className={cn(
          "shrink-0 border-border bg-surface lg:w-64 lg:border-r lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen",
          open ? "block border-b" : "hidden lg:flex",
        )}
      >
        <div className="hidden lg:flex items-center justify-between gap-2 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <p className="font-bold leading-tight truncate">{t("app.name")}</p>
            <p className="text-xs text-muted truncate">{t("app.tagline")}</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {groups.map((group, i) => (
            <div key={group.titleKey ?? i}>
              {group.titleKey && (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {t(group.titleKey)}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "text-foreground hover:bg-slate-100",
                        )}
                      >
                        <span className="truncate">{t(item.labelKey)}</span>
                        {item.badge ? (
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                              active ? "bg-white/25 text-white" : "bg-primary text-white",
                            )}
                          >
                            {item.badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-3 space-y-2">
          <div className="hidden lg:block">
            <LocaleSwitcher className="w-full justify-center" />
          </div>
          <div className="px-2">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-muted">{t(user.roleKey)}</p>
          </div>
          <form action={logoutAction}>
            <button className="w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-slate-100">
              {t("common.signOut")}
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
