import { Input, Toolbar } from "@/components/ui";
import {
  FilterForm,
  SelectField,
  ExportButtons,
  type Query,
} from "@/components/table-tools";
import { PERIOD_LABEL_KEY, PERIOD_PRESETS, type Period } from "@/lib/dates";
import type { T, TranslationKey } from "@/i18n";

/**
 * The period selector shared by every report (§10.3). Plain GET form, so the
 * selected range lives in the URL and the export routes can read the same query
 * string the screen was rendered from.
 */
export function PeriodFilter({
  t,
  action,
  period,
  exportHref,
  query,
  children,
}: {
  t: T;
  action: string;
  period: Period;
  exportHref?: string;
  query: Query;
  children?: React.ReactNode;
}) {
  return (
    <Toolbar>
      <FilterForm action={action} t={t}>
        <SelectField
          label={t("common.period")}
          name="preset"
          defaultValue={period.preset}
          options={PERIOD_PRESETS.map((p) => ({
            value: p,
            label: t(PERIOD_LABEL_KEY[p] as TranslationKey),
          }))}
        />
        <div className="min-w-36">
          <label className="mb-1 block text-xs font-medium text-muted" htmlFor="from">
            {t("common.dateFrom")}
          </label>
          <Input
            id="from"
            name="from"
            type="date"
            defaultValue={period.from}
            className="h-9 py-1.5 text-sm"
          />
        </div>
        <div className="min-w-36">
          <label className="mb-1 block text-xs font-medium text-muted" htmlFor="to">
            {t("common.dateTo")}
          </label>
          <Input
            id="to"
            name="to"
            type="date"
            defaultValue={period.to}
            className="h-9 py-1.5 text-sm"
          />
        </div>
        {children}
      </FilterForm>

      {exportHref && (
        <div className="ml-auto">
          <ExportButtons t={t} href={exportHref} query={query} />
        </div>
      )}
    </Toolbar>
  );
}

/** "01.01.2026 — 31.01.2026", for report subtitles. */
export function periodLabel(
  t: T,
  period: Period,
  format: (v: string) => string,
): string {
  return t("report.periodLabel", {
    from: format(period.from),
    to: format(period.to),
  });
}
