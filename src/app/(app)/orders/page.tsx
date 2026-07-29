import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n";
import { listOrders } from "@/lib/queries/orders";
import { listCustomerOptions } from "@/lib/queries/customers";
import type { OrderStatus } from "@/db/schema";
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
import { ORDER_STATUS_COLOR, orderStatusKey } from "@/lib/labels";

const STATUSES: OrderStatus[] = ["NEW", "PICKING", "READY", "SHIPPED", "CANCELLED"];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const { t, locale } = await getI18n();
  const params = await searchParams;

  const actor = { id: user.sub, role: user.role };
  const showMoney = can.seeSalePrices(actor);

  const query: Query = {
    q: params.q,
    status: params.status,
    customer: params.customer,
    late: params.late,
    page: params.page,
  };

  const [{ rows, total, page, pageCount }, customers] = await Promise.all([
    listOrders(user.role, {
      search: params.q,
      status:
        params.status === "OPEN"
          ? "OPEN"
          : STATUSES.includes(params.status as OrderStatus)
            ? (params.status as OrderStatus)
            : "ALL",
      customerId: params.customer ?? null,
      onlyLate: params.late === "1",
      // §2.1: a salesperson sees only their own orders.
      createdById: can.viewAllOrders(actor) ? undefined : user.sub,
      page: Number(params.page) || 1,
    }),
    listCustomerOptions(),
  ]);

  return (
    <>
      <PageHeader title={t("order.title")}>
        {can.createOrder(actor) && (
          <Link href="/orders/new">
            <Button size="sm">{t("order.new")}</Button>
          </Link>
        )}
      </PageHeader>

      <Card>
        <Toolbar>
          <FilterForm action="/orders" t={t}>
            <SearchField t={t} defaultValue={params.q} />
            <SelectField
              label={t("order.filterStatus")}
              name="status"
              defaultValue={params.status ?? "ALL"}
              options={[
                { value: "ALL", label: t("common.all") },
                { value: "OPEN", label: t("pick.inProgress") },
                ...STATUSES.map((s) => ({ value: s, label: t(orderStatusKey(s)) })),
              ]}
            />
            <SelectField
              label={t("order.filterCustomer")}
              name="customer"
              defaultValue={params.customer ?? ""}
              options={[
                { value: "", label: t("common.all") },
                ...customers.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <CheckboxField
              label={t("dash.lateOrders")}
              name="late"
              defaultChecked={params.late === "1"}
            />
          </FilterForm>
        </Toolbar>

        {rows.length === 0 ? (
          <EmptyState
            title={t("order.empty")}
            hint={can.createOrder(actor) ? t("order.emptyHint") : undefined}
            action={
              can.createOrder(actor) ? (
                <Link href="/orders/new">
                  <Button size="sm">{t("order.new")}</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{t("order.number")}</Th>
                  <Th>{t("order.customer")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th numeric>{t("order.lineCount")}</Th>
                  <Th numeric>{t("order.ordered")}</Th>
                  <Th numeric>{t("order.reserved")}</Th>
                  <Th numeric>{t("order.shortfall")}</Th>
                  {showMoney && <Th numeric>{t("common.total")}</Th>}
                  {showMoney && <Th numeric>{t("order.balance")}</Th>}
                  <Th>{t("order.plannedShipDate")}</Th>
                  <Th>{t("order.deadline")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/60">
                    <Td className="font-mono text-xs whitespace-nowrap">
                      <Link href={`/orders/${o.id}`} className="text-primary hover:underline">
                        {o.number}
                      </Link>
                    </Td>
                    <Td className="font-medium">{o.customerName}</Td>
                    <Td>
                      <Badge color={ORDER_STATUS_COLOR[o.status]}>
                        {t(orderStatusKey(o.status))}
                      </Badge>
                    </Td>
                    <Td numeric className="text-muted">
                      {o.lineCount}
                    </Td>
                    <Td numeric>{o.totalUnits}</Td>
                    <Td numeric className={o.reservedUnits > 0 ? "text-amber-700" : "text-muted"}>
                      {o.reservedUnits}
                    </Td>
                    <Td
                      numeric
                      className={o.shortfallUnits > 0 ? "font-semibold text-red-600" : "text-muted"}
                    >
                      {o.shortfallUnits || ""}
                    </Td>
                    {showMoney && <Td numeric>{formatMoney(o.totalCents, locale)}</Td>}
                    {showMoney && (
                      <Td
                        numeric
                        className={(o.balanceCents ?? 0) > 0 ? "text-red-600" : "text-muted"}
                      >
                        {o.status === "SHIPPED" ? formatMoney(o.balanceCents, locale) : ""}
                      </Td>
                    )}
                    <Td className="whitespace-nowrap text-muted">
                      {formatDate(o.plannedShipDate)}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      {o.shipDelayDays === null ? (
                        ""
                      ) : o.shipDelayDays > 0 ? (
                        <span className="text-red-600">
                          {t("order.lateBy", { days: o.shipDelayDays })}
                        </span>
                      ) : (
                        <span className="text-emerald-700">{t("order.onTime")}</span>
                      )}
                      {o.overdueDays !== null && o.overdueDays > 0 && (
                        <span className="block text-red-600">
                          {t("order.overdueBy", { days: o.overdueDays })}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              t={t}
              basePath="/orders"
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
