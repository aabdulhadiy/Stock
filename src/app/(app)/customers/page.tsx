import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatMoney } from "@/i18n";
import { listCustomers } from "@/lib/queries/customers";
import type { Channel } from "@/db/schema";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Table,
  Td,
  Th,
  Toolbar,
  PageHeader,
} from "@/components/ui";
import {
  CheckboxField,
  FilterForm,
  Pagination,
  SearchField,
  SelectField,
  type Query,
} from "@/components/table-tools";
import { CHANNELS } from "@/lib/validation";
import { GRADE_COLOR, channelKey, gradeKey } from "@/lib/labels";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireRole("DIRECTOR", "SALESPERSON");
  const { t, locale } = await getI18n();
  const params = await searchParams;

  const actor = { id: user.sub, role: user.role };
  const showMoney = can.seeSalePrices(actor);

  const query: Query = {
    q: params.q,
    channel: params.channel,
    debt: params.debt,
    page: params.page,
  };

  const { rows, total, page, pageCount } = await listCustomers({
    search: params.q,
    channel: CHANNELS.includes(params.channel as Channel)
      ? (params.channel as Channel)
      : "ALL",
    onlyWithDebt: params.debt === "1",
    page: Number(params.page) || 1,
  });

  return (
    <>
      <PageHeader title={t("customer.title")}>
        {can.manageCustomers(actor) && (
          <Link href="/customers/new">
            <Button size="sm">{t("customer.new")}</Button>
          </Link>
        )}
      </PageHeader>

      <Card>
        <Toolbar>
          <FilterForm action="/customers" t={t}>
            <SearchField t={t} defaultValue={params.q} />
            <SelectField
              label={t("customer.channel")}
              name="channel"
              defaultValue={params.channel ?? "ALL"}
              options={[
                { value: "ALL", label: t("common.all") },
                ...CHANNELS.map((c) => ({ value: c, label: t(channelKey(c)) })),
              ]}
            />
            {showMoney && (
              <CheckboxField
                label={t("customer.debt")}
                name="debt"
                defaultChecked={params.debt === "1"}
              />
            )}
          </FilterForm>
        </Toolbar>

        {rows.length === 0 ? (
          <EmptyState
            title={t("customer.empty")}
            action={
              can.manageCustomers(actor) ? (
                <Link href="/customers/new">
                  <Button size="sm">{t("customer.new")}</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{t("customer.name")}</Th>
                  <Th>{t("customer.phone")}</Th>
                  <Th>{t("customer.city")}</Th>
                  <Th>{t("customer.channel")}</Th>
                  <Th numeric>{t("customer.orders")}</Th>
                  {showMoney && <Th numeric>{t("customer.totalSales")}</Th>}
                  {showMoney && <Th numeric>{t("customer.debt")}</Th>}
                  <Th numeric>{t("customer.avgDelay")}</Th>
                  <Th>{t("customer.grade")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <Td className="font-medium">
                      <Link href={`/customers/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                      {!c.active && (
                        <Badge color="slate" className="ml-2">
                          {t("common.inactive")}
                        </Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{c.phone}</Td>
                    <Td className="text-muted">{c.city ?? "—"}</Td>
                    <Td>
                      <Badge color={c.channel === "EXPORT" ? "indigo" : "slate"}>
                        {t(channelKey(c.channel))}
                      </Badge>
                    </Td>
                    <Td numeric className="text-muted">
                      {c.orderCount}
                    </Td>
                    {showMoney && <Td numeric>{formatMoney(c.salesYtdCents, locale)}</Td>}
                    {showMoney && (
                      <Td numeric className={c.debtCents > 0 ? "font-semibold text-red-600" : "text-muted"}>
                        {c.debtCents > 0 ? formatMoney(c.debtCents, locale) : "—"}
                      </Td>
                    )}
                    <Td numeric className="text-muted">
                      {c.avgDelayDays === null ? "—" : `${c.avgDelayDays} ${t("common.days")}`}
                    </Td>
                    <Td>
                      {c.grade ? (
                        <Badge color={GRADE_COLOR[c.grade]} title={t(gradeKey(c.grade))}>
                          {c.grade}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted">{t("customer.gradeNone")}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              t={t}
              basePath="/customers"
              query={query}
              page={page}
              pageCount={pageCount}
              total={total}
            />
          </>
        )}
      </Card>
    </>
  );
}
