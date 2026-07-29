import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { requireDirector } from "@/lib/auth";
import { getI18n } from "@/i18n/server";
import { formatDateTime } from "@/i18n";
import { asc } from "drizzle-orm";
import {
  Badge,
  Card,
  EmptyState,
  Table,
  Td,
  Th,
  Toolbar,
  PageHeader,
} from "@/components/ui";
import {
  FilterForm,
  Pagination,
  SelectField,
  type Query,
} from "@/components/table-tools";
import type { TranslationKey } from "@/i18n";
import { AUDIT_ACTIONS, AUDIT_ENTITIES, ChangeCell } from "./change-cell";

const PAGE_SIZE = 50;

/**
 * §12 audit log, filterable by user, date range and entity type.
 *
 * Values are rendered as the field-level diff each action recorded, so a row
 * reads "market_price_cents: 1200 → 1000" rather than dumping a whole record.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireDirector();
  const { t, locale } = await getI18n();
  const params = await searchParams;

  const page = Math.max(1, Number(params.page) || 1);
  const query: Query = {
    entity: params.entity,
    action: params.action,
    user: params.user,
    from: params.from,
    to: params.to,
    page: params.page,
  };

  const conditions = [];
  if (params.entity && AUDIT_ENTITIES.includes(params.entity)) {
    conditions.push(eq(auditLog.entity, params.entity));
  }
  if (params.action && AUDIT_ACTIONS.includes(params.action)) {
    conditions.push(eq(auditLog.action, params.action));
  }
  if (params.user) conditions.push(eq(auditLog.userId, params.user));
  if (params.from) conditions.push(gte(auditLog.at, new Date(`${params.from}T00:00:00`)));
  if (params.to) conditions.push(lte(auditLog.at, new Date(`${params.to}T23:59:59`)));
  const where = conditions.length ? and(...conditions) : undefined;

  const [countRow] = await db.select({ n: count() }).from(auditLog).where(where);
  const total = Number(countRow?.n ?? 0);

  const [rows, userList] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        action: auditLog.action,
        label: auditLog.label,
        oldValue: auditLog.oldValue,
        newValue: auditLog.newValue,
        userName: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(where)
      .orderBy(desc(auditLog.at))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
  ]);

  return (
    <>
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />

      <Card>
        <Toolbar>
          <FilterForm action="/audit" t={t}>
            <SelectField
              label={t("audit.filterEntity")}
              name="entity"
              defaultValue={params.entity ?? ""}
              options={[
                { value: "", label: t("common.all") },
                ...AUDIT_ENTITIES.map((e) => ({
                  value: e,
                  label: t(`audit.entity.${e}` as TranslationKey),
                })),
              ]}
            />
            <SelectField
              label={t("audit.action")}
              name="action"
              defaultValue={params.action ?? ""}
              options={[
                { value: "", label: t("common.all") },
                ...AUDIT_ACTIONS.map((a) => ({
                  value: a,
                  label: t(`audit.action.${a}` as TranslationKey),
                })),
              ]}
            />
            <SelectField
              label={t("audit.filterUser")}
              name="user"
              defaultValue={params.user ?? ""}
              options={[
                { value: "", label: t("common.all") },
                ...userList.map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
            <div className="min-w-36">
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="from">
                {t("common.dateFrom")}
              </label>
              <input
                id="from"
                name="from"
                type="date"
                defaultValue={params.from ?? ""}
                className="h-9 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
              />
            </div>
            <div className="min-w-36">
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="to">
                {t("common.dateTo")}
              </label>
              <input
                id="to"
                name="to"
                type="date"
                defaultValue={params.to ?? ""}
                className="h-9 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
              />
            </div>
          </FilterForm>
        </Toolbar>

        {rows.length === 0 ? (
          <EmptyState title={t("audit.empty")} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{t("audit.when")}</Th>
                  <Th>{t("audit.who")}</Th>
                  <Th>{t("audit.entity")}</Th>
                  <Th>{t("audit.action")}</Th>
                  <Th>{t("audit.subject")}</Th>
                  <Th>{t("audit.change")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-slate-50/60">
                    <Td className="whitespace-nowrap text-xs">
                      {formatDateTime(r.at, locale)}
                    </Td>
                    <Td className="whitespace-nowrap">{r.userName ?? "—"}</Td>
                    <Td>
                      <Badge color="slate">
                        {AUDIT_ENTITIES.includes(r.entity)
                          ? t(`audit.entity.${r.entity}` as TranslationKey)
                          : r.entity}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge
                        color={
                          r.action === "delete" || r.action === "cancel"
                            ? "red"
                            : r.action === "price_change"
                              ? "amber"
                              : r.action === "create"
                                ? "green"
                                : "blue"
                        }
                      >
                        {AUDIT_ACTIONS.includes(r.action)
                          ? t(`audit.action.${r.action}` as TranslationKey)
                          : r.action}
                      </Badge>
                    </Td>
                    <Td className="font-medium">{r.label ?? "—"}</Td>
                    <Td>
                      <ChangeCell oldValue={r.oldValue} newValue={r.newValue} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              t={t}
              basePath="/audit"
              query={query}
              page={page}
              pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
              total={total}
            />
          </>
        )}
      </Card>
    </>
  );
}
