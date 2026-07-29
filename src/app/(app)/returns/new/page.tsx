import { requireDirector } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { listShippedOrders } from "@/lib/queries/orders";
import { getReturnableLines } from "@/lib/returns";
import { today } from "@/lib/dates";
import { Alert, PageHeader } from "@/components/ui";
import { ReturnForm } from "./form";

export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  await requireDirector();
  const t = await getT();
  const { order } = await searchParams;

  const shipped = await listShippedOrders();
  const selected = order && shipped.some((o) => o.id === order) ? order : null;
  const lines = selected ? await getReturnableLines(selected) : [];

  return (
    <>
      <PageHeader title={t("return.new")} />
      {shipped.length === 0 ? (
        <Alert variant="info">{t("return.noShippedOrders")}</Alert>
      ) : (
        <ReturnForm
          orders={shipped.map((o) => ({
            id: o.id,
            label: `${o.number} — ${o.customerName}`,
          }))}
          selectedOrderId={selected}
          lines={lines}
          today={today()}
        />
      )}
    </>
  );
}
