import Link from "next/link";
import { Button, Input, Select, Th } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { T, TranslationKey } from "@/i18n";

/**
 * Filter, sort and pagination controls built on plain GET forms and links.
 *
 * No client JavaScript: the state lives in the URL, so a filtered list can be
 * bookmarked, shared, reloaded, and — importantly for §7.5 — handed straight to
 * an export route with the same query string.
 */

export type Query = Record<string, string | undefined>;

/** Build a query string, dropping empty values and resetting the page. */
export function buildQuery(current: Query, patch: Query): string {
  const params = new URLSearchParams();
  const merged = { ...current, ...patch };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === "" || value === "ALL") continue;
    params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** A GET filter bar. Children are the inputs; names map straight to params. */
export function FilterForm({
  action,
  t,
  children,
  hidden,
}: {
  action: string;
  t: T;
  children: React.ReactNode;
  hidden?: Query;
}) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-3">
      {Object.entries(hidden ?? {}).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      {children}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" size="sm">
          {t("common.apply")}
        </Button>
        <Link
          href={action}
          className="inline-flex min-h-8 items-center rounded-md px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-slate-100"
        >
          {t("common.reset")}
        </Link>
      </div>
    </form>
  );
}

export function SearchField({
  t,
  defaultValue,
  name = "q",
  placeholderKey = "common.searchPlaceholder",
}: {
  t: T;
  defaultValue?: string;
  name?: string;
  placeholderKey?: TranslationKey;
}) {
  return (
    <div className="min-w-48">
      <label className="block text-xs font-medium text-muted mb-1" htmlFor={name}>
        {t("common.search")}
      </label>
      <Input
        id={name}
        name={name}
        defaultValue={defaultValue}
        placeholder={t(placeholderKey)}
        className="h-9 py-1.5 text-sm"
      />
    </div>
  );
}

export function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="min-w-36">
      <label className="block text-xs font-medium text-muted mb-1" htmlFor={name}>
        {label}
      </label>
      <Select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="h-9 py-1.5 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function CheckboxField({
  label,
  name,
  defaultChecked,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-2 pb-2 text-sm">
      <input
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={defaultChecked}
        className="size-4 rounded border-border"
      />
      {label}
    </label>
  );
}

/** A sortable column header: clicking it sets `?sort=`. */
export function SortableTh({
  label,
  sortKey,
  current,
  basePath,
  query,
  numeric,
}: {
  label: string;
  sortKey: string;
  current?: string;
  basePath: string;
  query: Query;
  numeric?: boolean;
}) {
  const active = current === sortKey;
  return (
    <Th numeric={numeric}>
      <Link
        href={`${basePath}${buildQuery(query, { sort: sortKey, page: undefined })}`}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active && "text-foreground font-semibold",
        )}
      >
        {label}
        {active && <span aria-hidden>↓</span>}
      </Link>
    </Th>
  );
}

export function Pagination({
  t,
  basePath,
  query,
  page,
  pageCount,
  total,
}: {
  t: T;
  basePath: string;
  query: Query;
  page: number;
  pageCount: number;
  total: number;
}) {
  if (pageCount <= 1) {
    return (
      <p className="px-5 py-3 text-xs text-muted">
        {t("stock.totals", { products: total, units: "" }).replace(/ · $/, "")}
      </p>
    );
  }
  const prev = Math.max(1, page - 1);
  const next = Math.min(pageCount, page + 1);
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
      <span className="text-xs text-muted tabular-nums">
        {page} / {pageCount} · {total}
      </span>
      <div className="flex gap-2">
        <Link
          href={`${basePath}${buildQuery(query, { page: String(prev) })}`}
          aria-disabled={page === 1}
          className={cn(
            "rounded-md border border-border px-3 py-1.5 text-xs font-medium",
            page === 1 ? "pointer-events-none opacity-40" : "hover:bg-slate-50",
          )}
        >
          ←
        </Link>
        <Link
          href={`${basePath}${buildQuery(query, { page: String(next) })}`}
          aria-disabled={page === pageCount}
          className={cn(
            "rounded-md border border-border px-3 py-1.5 text-xs font-medium",
            page === pageCount ? "pointer-events-none opacity-40" : "hover:bg-slate-50",
          )}
        >
          →
        </Link>
      </div>
    </nav>
  );
}

/** Excel / PDF export buttons pointing at a route with the current filters. */
export function ExportButtons({
  t,
  href,
  query,
}: {
  t: T;
  href: string;
  query: Query;
}) {
  return (
    <div className="flex gap-2">
      <Link
        href={`${href}${buildQuery(query, { format: "xlsx" })}`}
        prefetch={false}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"
      >
        {t("common.exportExcel")}
      </Link>
      <Link
        href={`${href}${buildQuery(query, { format: "pdf" })}`}
        prefetch={false}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"
      >
        {t("common.exportPdf")}
      </Link>
    </div>
  );
}
