"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createReturnAction } from "@/app/(app)/receivables/actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { useI18n } from "@/i18n/client";
import { formatMoney } from "@/i18n";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Table,
  Td,
  Textarea,
  Tf,
  Th,
} from "@/components/ui";

export interface ReturnableLine {
  orderItemId: string;
  sku: string;
  name: string;
  shippedUnits: number;
  alreadyReturnedUnits: number;
  remainingUnits: number;
  unitPriceCents: number;
}

/**
 * Create a return document (§11). Picking the order reloads the page with its
 * lines, so the returnable quantities are always read fresh from the server
 * rather than trusted from the client.
 */
export function ReturnForm({
  orders,
  selectedOrderId,
  lines,
  today,
}: {
  orders: { id: string; label: string }[];
  selectedOrderId: string | null;
  lines: ReturnableLine[];
  today: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { state, pending, submit } = useFormAction(
    createReturnAction,
    EMPTY_FORM_STATE,
  );

  const [quantities, setQuantities] = React.useState<Record<string, string>>({});

  const creditFor = (line: ReturnableLine): number => {
    const qty = Number(quantities[line.orderItemId] ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    return qty * line.unitPriceCents;
  };
  const totalCredit = lines.reduce((s, l) => s + creditFor(l), 0);

  return (
    <form onSubmit={submit} className="space-y-5">
      {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}
      {state.ok && state.message && (
        <Alert variant="success">{translateIssue(t, state.message)}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("return.selectOrder")}</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label={t("return.order")} htmlFor="orderId" required>
            <Select
              id="orderId"
              name="orderId"
              value={selectedOrderId ?? ""}
              onChange={(e) => {
                // Reload with the chosen order so its lines come from the server.
                const next = e.target.value;
                router.push(next ? `/returns/new?order=${next}` : "/returns/new");
              }}
              required
            >
              <option value="">—</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={t("return.date")}
            htmlFor="returnDate"
            required
            error={translateIssue(t, state.fieldErrors?.returnDate)}
          >
            <Input
              id="returnDate"
              name="returnDate"
              type="date"
              defaultValue={today}
              required
            />
          </Field>

          <Field label={t("common.note")} htmlFor="note">
            <Textarea id="note" name="note" rows={1} />
          </Field>
        </CardBody>
      </Card>

      {selectedOrderId && (
        <Card>
          <CardHeader>
            <CardTitle>{t("return.forOrder", { number: "" }).trim()}</CardTitle>
            <span className="text-sm font-semibold tabular-nums">
              {t("return.value")}: {formatMoney(totalCredit, locale)}
            </span>
          </CardHeader>
          <Table>
            <thead>
              <tr>
                <Th>{t("product.sku")}</Th>
                <Th>{t("common.product")}</Th>
                <Th numeric>{t("return.qtyShipped")}</Th>
                <Th numeric>{t("return.qtyAlreadyReturned")}</Th>
                <Th numeric>{t("order.unitPrice")}</Th>
                <Th numeric>{t("return.qtyReturned")}</Th>
                <Th numeric>{t("return.value")}</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.orderItemId}>
                  <input type="hidden" name="orderItemId" value={line.orderItemId} />
                  <Td className="font-mono text-xs">{line.sku}</Td>
                  <Td className="font-medium">{line.name}</Td>
                  <Td numeric>{line.shippedUnits}</Td>
                  <Td numeric className="text-muted">
                    {line.alreadyReturnedUnits || "—"}
                  </Td>
                  <Td numeric>{formatMoney(line.unitPriceCents, locale)}</Td>
                  <Td numeric className="w-28">
                    <Input
                      name="qty"
                      inputMode="numeric"
                      value={quantities[line.orderItemId] ?? ""}
                      max={line.remainingUnits}
                      disabled={line.remainingUnits === 0}
                      onChange={(e) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [line.orderItemId]: e.target.value,
                        }))
                      }
                      className="text-right"
                      placeholder={String(line.remainingUnits)}
                    />
                  </Td>
                  <Td numeric className="font-medium">
                    {creditFor(line) ? formatMoney(creditFor(line), locale) : ""}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Tf colSpan={6}>{t("return.value")}</Tf>
                <Tf numeric>{formatMoney(totalCredit, locale)}</Tf>
              </tr>
            </tfoot>
          </Table>
          <CardBody className="border-t border-border">
            <Button type="submit" disabled={pending || totalCredit === 0}>
              {pending ? t("common.saving") : t("return.new")}
            </Button>
          </CardBody>
        </Card>
      )}
    </form>
  );
}
