import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canVoidSale } from "@/lib/permissions";
import { getSaleDetail } from "@/lib/queries";
import { formatMoney, round2 } from "@/lib/currency";
import { Button, Card, CardHeader, CardTitle, CardBody, Table, Th, Td, Badge } from "@/components/ui";
import type { Currency } from "@/db/schema";
import { voidSaleAction } from "../actions";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getSaleDetail(id);
  if (!detail) notFound();
  const { sale, items } = detail;

  // Managers may only view their own shop's sales.
  if (user.role === "SALES_MANAGER" && sale.shopId !== user.shopId) redirect("/sales");

  const currency = sale.currency as Currency;
  const showVoid = sale.status === "COMPLETED" && canVoidSale(user, { salesManagerId: sale.salesManagerId });

  const voidThis = voidSaleAction.bind(null, sale.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/sales" className="text-sm text-primary">
            ← Back to sales
          </Link>
          <h1 className="text-2xl font-bold mt-1">Sale summary</h1>
          <p className="text-muted text-sm">
            {new Date(sale.createdAt).toLocaleString()} · {sale.shopName}
          </p>
        </div>
        <div className="text-right space-y-2">
          {sale.status === "COMPLETED" ? (
            <Badge color="green">Completed</Badge>
          ) : (
            <Badge color="red">Voided</Badge>
          )}
          {showVoid && (
            <form action={voidThis}>
              <Button type="submit" variant="danger" size="sm">
                Void sale
              </Button>
            </form>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <InfoCard label="Customer">
          {sale.customerName ? (
            <>
              <p className="font-medium">{sale.customerName}</p>
              <p className="text-sm text-muted">{sale.customerPhone}</p>
            </>
          ) : (
            <p className="font-medium">{sale.customerNote ? sale.customerNote : "One-time customer"}</p>
          )}
        </InfoCard>
        <InfoCard label="Sales manager">
          <p className="font-medium">{sale.managerName}</p>
        </InfoCard>
        <InfoCard label="Currency / rate">
          <p className="font-medium">{currency}</p>
          <p className="text-sm text-muted">{Number(sale.exchangeRateUsed).toLocaleString("ru-RU")} UZS/$</p>
        </InfoCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Suggested</Th>
              <Th className="text-right">Actual</Th>
              <Th className="text-right">Line total</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const actual = Number(it.actualPrice);
              const suggested = Number(it.suggestedPrice);
              const lineTotal = round2(actual * it.quantity);
              return (
                <tr key={it.id}>
                  <Td className="font-medium">{it.productName}</Td>
                  <Td className="text-right tabular-nums">{it.quantity}</Td>
                  <Td className="text-right tabular-nums text-muted">{formatMoney(suggested, currency)}</Td>
                  <Td className="text-right tabular-nums">
                    {formatMoney(actual, currency)}
                    {round2(actual) !== round2(suggested) && (
                      <Badge color="amber" className="ml-2">
                        {actual < suggested ? "discount" : "markup"}
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(lineTotal, currency)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <CardBody className="flex justify-end">
          <div className="text-right">
            <p className="text-sm text-muted">Total</p>
            <p className="text-2xl font-bold tabular-nums">{formatMoney(sale.totalAmount, currency)}</p>
            <p className="text-xs text-muted">
              ≈ {Number(sale.totalAmountUzs).toLocaleString("ru-RU")} so&apos;m
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs uppercase tracking-wide text-muted mb-1">{label}</p>
        {children}
      </CardBody>
    </Card>
  );
}
