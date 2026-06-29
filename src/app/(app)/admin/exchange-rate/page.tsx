import { requireRole } from "@/lib/auth";
import { getCurrentRate, getExchangeRateHistory } from "@/lib/queries";
import { Card, CardHeader, CardTitle, CardBody, Table, Th, Td } from "@/components/ui";
import { RateForm } from "@/components/rate-form";
import { setExchangeRate } from "./actions";

export default async function ExchangeRatePage() {
  await requireRole("ADMIN");
  const [current, history] = await Promise.all([
    getCurrentRate(),
    getExchangeRateHistory(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Exchange rate</h1>
        <p className="text-muted text-sm mt-1">
          UZS per 1 USD. Each sale stores the rate active at that moment, so changing it never
          alters past sales.
        </p>
      </div>

      <div className="grid lg:grid-cols-5 gap-6 items-start">
        <Card className="lg:col-span-2">
          <CardBody>
            <p className="text-sm text-muted">Current rate</p>
            <p className="text-3xl font-bold mt-1 tabular-nums">
              {current.toLocaleString("ru-RU")}
            </p>
            <p className="text-xs text-muted mt-1">UZS = $1</p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Set a new rate</CardTitle>
          </CardHeader>
          <CardBody>
            <RateForm action={setExchangeRate} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Effective from</Th>
              <Th className="text-right">Rate (UZS/USD)</Th>
              <Th>Set by</Th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <Td className="text-muted">{new Date(h.effectiveFrom).toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{Number(h.rate).toLocaleString("ru-RU")}</Td>
                <Td className="text-muted">{h.setBy ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
