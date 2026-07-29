"use client";

import * as React from "react";
import Link from "next/link";
import { createOrderAction, updateOrderAction } from "@/app/(app)/orders/actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { useI18n } from "@/i18n/client";
import { formatMoney } from "@/i18n";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import { PAYMENT_TERMS } from "@/lib/validation";
import { paymentTermLabel } from "@/lib/labels";
import type { ProductPickerOption } from "@/lib/queries/products";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Hint,
  Input,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  Tf,
} from "@/components/ui";

export interface CustomerOption {
  id: string;
  name: string;
  phone: string;
  channel: string;
  defaultPriceType: "MARKET" | "EXPORT";
  defaultTermDays: number | null;
}

export interface OrderFormLine {
  lineId?: string;
  productId: string;
  qty: string;
  enteredAs: "UNITS" | "BOXES" | "BAGS";
  /** Price as a decimal string for the input. */
  unitPrice: string;
  /** True once the user has typed a price, so re-defaulting leaves it alone. */
  overridden: boolean;
}

export interface OrderFormValues {
  id?: string;
  customerId: string;
  priceType: "MARKET" | "EXPORT";
  plannedShipDate: string;
  paymentMethod: "CASH" | "BANK";
  paymentTermDays: number;
  note: string;
  lines: OrderFormLine[];
}

let nextKey = 1;
const blankLine = (): OrderFormLine & { key: number } => ({
  key: nextKey++,
  productId: "",
  qty: "",
  enteredAs: "UNITS",
  unitPrice: "",
  overridden: false,
});

type Line = OrderFormLine & { key: number };

/**
 * Order creation and editing (§5.1, §5.2).
 *
 * Two behaviours the spec calls out explicitly:
 *
 *  - Choosing a customer suggests the price type from their channel, and
 *    changing the price type re-defaults every line price that the user has not
 *    typed over. A price the user has typed is never silently rewritten.
 *  - Availability is shown per line for information only. Creating an order
 *    reserves nothing (BR-1), and the form says so rather than implying a hold.
 */
export function OrderForm({
  mode,
  values,
  products,
  customers,
  today,
  status,
}: {
  mode: "create" | "edit";
  values?: OrderFormValues;
  products: ProductPickerOption[];
  customers: CustomerOption[];
  today: string;
  /** Present when editing, so the form can warn about reservation effects. */
  status?: "NEW" | "PICKING" | "READY";
}) {
  const { t, locale } = useI18n();
  const { state, pending, submit } = useFormAction(
    mode === "create" ? createOrderAction : updateOrderAction,
    EMPTY_FORM_STATE,
    { resetOnSuccess: false },
  );

  const [customerId, setCustomerId] = React.useState(values?.customerId ?? "");
  const [priceType, setPriceType] = React.useState<"MARKET" | "EXPORT">(
    values?.priceType ?? "MARKET",
  );
  const [termDays, setTermDays] = React.useState(String(values?.paymentTermDays ?? 0));
  const [lines, setLines] = React.useState<Line[]>(
    values?.lines?.length
      ? values.lines.map((l) => ({ ...l, key: nextKey++ }))
      : [blankLine()],
  );

  const productById = React.useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const customerById = React.useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );

  /** The catalog price for a product under a given price type. */
  const catalogPrice = React.useCallback(
    (productId: string, type: "MARKET" | "EXPORT"): number | undefined => {
      const product = productById.get(productId);
      if (!product) return undefined;
      return type === "EXPORT" ? product.exportPriceCents : product.marketPriceCents;
    },
    [productById],
  );

  /** §5.1: the customer's channel suggests the price type and payment term. */
  const onCustomerChange = (id: string) => {
    setCustomerId(id);
    const customer = customerById.get(id);
    if (!customer) return;
    applyPriceType(customer.defaultPriceType);
    if (customer.defaultTermDays !== null) setTermDays(String(customer.defaultTermDays));
  };

  /** Re-default every non-overridden line price to the new price type. */
  const applyPriceType = (type: "MARKET" | "EXPORT") => {
    setPriceType(type);
    setLines((prev) =>
      prev.map((line) => {
        if (line.overridden || !line.productId) return line;
        const cents = catalogPrice(line.productId, type);
        return { ...line, unitPrice: cents === undefined ? line.unitPrice : centsToInput(cents) };
      }),
    );
  };

  const update = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onProductChange = (key: number, productId: string) => {
    const cents = catalogPrice(productId, priceType);
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              productId,
              // A fresh product resets the price to catalog unless the user had
              // deliberately typed one.
              unitPrice: l.overridden ? l.unitPrice : centsToInput(cents ?? 0),
            }
          : l,
      ),
    );
  };

  const unitsFor = (line: Line): number => {
    const product = productById.get(line.productId);
    const qty = Number(line.qty);
    if (!product || !Number.isFinite(qty) || qty <= 0) return 0;
    if (line.enteredAs === "BOXES") return qty * product.unitsPerBox;
    if (line.enteredAs === "BAGS") return qty * (product.unitsPerBag ?? product.unitsPerBox);
    return qty;
  };

  const lineTotal = (line: Line): number => {
    const cents = parseMoneyToCents(line.unitPrice);
    if (cents === null) return 0;
    return cents * unitsFor(line);
  };

  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  const filledLines = lines.filter((l) => l.productId && Number(l.qty) > 0);

  return (
    <form onSubmit={submit} className="space-y-5">
      {values?.id && <input type="hidden" name="id" value={values.id} />}

      {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}
      {status && status !== "NEW" && (
        <Alert variant="warning">{t("order.reserveTopUp", { qty: "" }).trim()}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{mode === "create" ? t("order.new") : t("common.edit")}</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label={t("order.customer")}
            htmlFor="customerId"
            required
            error={translateIssue(t, state.fieldErrors?.customerId)}
            className="sm:col-span-2"
          >
            <Select
              id="customerId"
              name="customerId"
              value={customerId}
              onChange={(e) => onCustomerChange(e.target.value)}
              required
            >
              <option value="">—</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.phone}
                </option>
              ))}
            </Select>
            <Hint>
              <Link href="/customers/new" className="text-primary hover:underline">
                {t("customer.createInline")}
              </Link>
            </Hint>
          </Field>

          <Field
            label={t("order.priceType")}
            htmlFor="priceType"
            required
            error={translateIssue(t, state.fieldErrors?.priceType)}
          >
            <Select
              id="priceType"
              name="priceType"
              value={priceType}
              onChange={(e) => applyPriceType(e.target.value as "MARKET" | "EXPORT")}
            >
              <option value="MARKET">{t("order.priceType.MARKET")}</option>
              <option value="EXPORT">{t("order.priceType.EXPORT")}</option>
            </Select>
            <Hint>{t("order.priceTypeHint")}</Hint>
          </Field>

          <Field
            label={t("order.plannedShipDate")}
            htmlFor="plannedShipDate"
            required
            error={translateIssue(t, state.fieldErrors?.plannedShipDate)}
          >
            <Input
              id="plannedShipDate"
              name="plannedShipDate"
              type="date"
              defaultValue={values?.plannedShipDate ?? today}
              required
            />
          </Field>

          <Field
            label={t("order.paymentMethod")}
            htmlFor="paymentMethod"
            required
            error={translateIssue(t, state.fieldErrors?.paymentMethod)}
          >
            <Select
              id="paymentMethod"
              name="paymentMethod"
              defaultValue={values?.paymentMethod ?? "CASH"}
            >
              <option value="CASH">{t("order.paymentMethod.CASH")}</option>
              <option value="BANK">{t("order.paymentMethod.BANK")}</option>
            </Select>
          </Field>

          <Field
            label={t("order.paymentTerm")}
            htmlFor="paymentTermDays"
            required
            error={translateIssue(t, state.fieldErrors?.paymentTermDays)}
          >
            <Select
              id="paymentTermDays"
              name="paymentTermDays"
              value={termDays}
              onChange={(e) => setTermDays(e.target.value)}
            >
              {PAYMENT_TERMS.map((d) => (
                <option key={d} value={d}>
                  {paymentTermLabel(t, d)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("common.note")} htmlFor="note" className="sm:col-span-2 lg:col-span-3">
            <Textarea id="note" name="note" rows={2} defaultValue={values?.note ?? ""} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("order.lines")}</CardTitle>
          <span className="text-sm font-semibold tabular-nums">
            {t("common.total")}: {formatMoney(total, locale)}
          </span>
        </CardHeader>

        <Table>
          <thead>
            <tr>
              <Th>{t("common.product")}</Th>
              <Th numeric>{t("common.qty")}</Th>
              <Th>{t("order.enteredAs")}</Th>
              <Th numeric>{t("common.units")}</Th>
              <Th numeric>{t("order.availableNow")}</Th>
              <Th numeric>{t("order.unitPrice")}</Th>
              <Th numeric>{t("order.lineTotal")}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const product = productById.get(line.productId);
              const units = unitsFor(line);
              const base = catalogPrice(line.productId, priceType);
              const typed = parseMoneyToCents(line.unitPrice);
              const discounted = base !== undefined && typed !== null && typed < base;
              const markedUp = base !== undefined && typed !== null && typed > base;

              return (
                <tr key={line.key}>
                  {line.lineId && (
                    <input type="hidden" name="lineId" value={line.lineId} />
                  )}
                  {!line.lineId && <input type="hidden" name="lineId" value="" />}

                  <Td className="min-w-56">
                    <Select
                      name="productId"
                      value={line.productId}
                      onChange={(e) => onProductChange(line.key, e.target.value)}
                    >
                      <option value="">—</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </Select>
                  </Td>

                  <Td numeric className="w-24">
                    <Input
                      name="qty"
                      inputMode="numeric"
                      value={line.qty}
                      onChange={(e) => update(line.key, { qty: e.target.value })}
                      className="text-right"
                    />
                  </Td>

                  <Td className="w-32">
                    <Select
                      name="enteredAs"
                      value={line.enteredAs}
                      onChange={(e) =>
                        update(line.key, {
                          enteredAs: e.target.value as Line["enteredAs"],
                        })
                      }
                    >
                      <option value="UNITS">{t("order.enteredAs.UNITS")}</option>
                      <option value="BOXES">{t("order.enteredAs.BOXES")}</option>
                      {product?.unitsPerBag ? (
                        <option value="BAGS">{t("order.enteredAs.BAGS")}</option>
                      ) : null}
                    </Select>
                  </Td>

                  <Td numeric className="text-muted">
                    {units || ""}
                  </Td>

                  <Td numeric>
                    {product ? (
                      <span
                        className={
                          units > product.available
                            ? "font-semibold text-amber-700"
                            : "text-muted"
                        }
                      >
                        {product.available}
                      </span>
                    ) : (
                      ""
                    )}
                  </Td>

                  <Td numeric className="w-28">
                    <Input
                      name="unitPrice"
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(e) =>
                        update(line.key, { unitPrice: e.target.value, overridden: true })
                      }
                      className="text-right"
                    />
                    {(discounted || markedUp) && base !== undefined && (
                      <Badge color={discounted ? "amber" : "blue"} className="mt-1">
                        {discounted ? t("order.discount") : t("order.markup")}{" "}
                        {formatMoney(base, locale)}
                      </Badge>
                    )}
                  </Td>

                  <Td numeric className="font-medium">
                    {lineTotal(line) ? formatMoney(lineTotal(line), locale) : ""}
                  </Td>

                  <Td>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setLines((prev) => prev.filter((l) => l.key !== line.key))
                        }
                        className="text-xs text-red-600 hover:underline"
                      >
                        {t("common.remove")}
                      </button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <Tf colSpan={6}>{t("common.total")}</Tf>
              <Tf numeric>{formatMoney(total, locale)}</Tf>
              <Tf />
            </tr>
          </tfoot>
        </Table>

        <CardBody className="border-t border-border">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setLines((prev) => [...prev, blankLine()])}
          >
            {t("order.addProduct")}
          </Button>
          <p className="mt-3 text-xs text-muted">{t("order.noReservationYet")}</p>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || filledLines.length === 0}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
        <Link
          href={values?.id ? `/orders/${values.id}` : "/orders"}
          className="text-sm text-muted hover:underline"
        >
          {t("common.cancel")}
        </Link>
      </div>
    </form>
  );
}
