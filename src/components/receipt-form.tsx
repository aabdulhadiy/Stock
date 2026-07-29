"use client";

import * as React from "react";
import { createReceiptAction } from "@/app/(app)/receipts/actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { useT } from "@/i18n/client";
import type { ProductPickerOption } from "@/lib/queries/products";
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
  Textarea,
} from "@/components/ui";

interface Line {
  key: number;
  productId: string;
  qty: string;
  enteredAs: "UNITS" | "BOXES" | "BAGS";
}

let nextKey = 1;
const blankLine = (): Line => ({
  key: nextKey++,
  productId: "",
  qty: "",
  enteredAs: "UNITS",
});

/**
 * Goods receipt entry (§4.2). Repeatable rows; quantities may be typed in
 * units, boxes or bags and the resulting unit count is shown live so the
 * warehouseman can see what will actually be booked in.
 */
export function ReceiptForm({
  products,
  today,
}: {
  products: ProductPickerOption[];
  today: string;
}) {
  const t = useT();
  const [lines, setLines] = React.useState<Line[]>([blankLine()]);
  // Back to a single blank row once the receipt is booked in.
  const { state, pending, submit } = useFormAction(
    createReceiptAction,
    EMPTY_FORM_STATE,
    { onSuccess: () => setLines([blankLine()]) },
  );

  const byId = React.useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const unitsFor = (line: Line): number | null => {
    const product = byId.get(line.productId);
    const qty = Number(line.qty);
    if (!product || !Number.isFinite(qty) || qty <= 0) return null;
    if (line.enteredAs === "BOXES") return qty * product.unitsPerBox;
    if (line.enteredAs === "BAGS") return qty * (product.unitsPerBag ?? product.unitsPerBox);
    return qty;
  };

  const update = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const totalUnits = lines.reduce((s, l) => s + (unitsFor(l) ?? 0), 0);

  return (
    <form onSubmit={submit} className="space-y-5">
      {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}
      {state.ok && state.message && (
        <Alert variant="success">{translateIssue(t, state.message)}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("receipt.new")}</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("receipt.date")}
            htmlFor="date"
            required
            error={translateIssue(t, state.fieldErrors?.date)}
          >
            <Input id="date" name="date" type="date" defaultValue={today} required />
          </Field>
          <Field label={t("common.note")} htmlFor="note">
            <Textarea id="note" name="note" rows={2} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("common.products")}</CardTitle>
          <span className="text-sm text-muted tabular-nums">
            {t("common.total")}: {totalUnits} {t("common.units")}
          </span>
        </CardHeader>
        <CardBody className="space-y-3">
          {lines.map((line) => {
            const product = byId.get(line.productId);
            const units = unitsFor(line);
            return (
              <div
                key={line.key}
                className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_100px_130px_auto] sm:items-end"
              >
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    {t("common.product")}
                  </label>
                  <Select
                    name="productId"
                    value={line.productId}
                    onChange={(e) => update(line.key, { productId: e.target.value })}
                  >
                    <option value="">—</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    {t("common.qty")}
                  </label>
                  <Input
                    name="qty"
                    inputMode="numeric"
                    value={line.qty}
                    onChange={(e) => update(line.key, { qty: e.target.value })}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    {t("order.enteredAs")}
                  </label>
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
                </div>

                <div className="flex items-center gap-3 pb-1">
                  <span className="min-w-20 text-sm tabular-nums text-muted">
                    {units === null ? "" : `= ${units} ${t("common.pcs")}`}
                  </span>
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
                </div>
              </div>
            );
          })}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setLines((prev) => [...prev, blankLine()])}
          >
            {t("receipt.addProduct")}
          </Button>
        </CardBody>
      </Card>

      <Button type="submit" disabled={pending || totalUnits === 0}>
        {pending ? t("common.saving") : t("common.save")}
      </Button>
    </form>
  );
}
