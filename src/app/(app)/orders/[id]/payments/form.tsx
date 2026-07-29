"use client";

import {
  deletePaymentAction,
  recordPaymentAction,
} from "@/app/(app)/receivables/actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { useI18n } from "@/i18n/client";
import { formatMoney } from "@/i18n";
import { centsToInput } from "@/lib/money";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Hint,
  Input,
  Select,
  Textarea,
} from "@/components/ui";

/** Record a payment, in full or in part (§5.4). */
export function PaymentForm({
  orderId,
  today,
  defaultMethod,
  balanceCents,
}: {
  orderId: string;
  today: string;
  defaultMethod: "CASH" | "BANK";
  balanceCents: number;
}) {
  const { t, locale } = useI18n();
  const { state, pending, submit } = useFormAction(
    recordPaymentAction,
    EMPTY_FORM_STATE,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("payment.record")}</CardTitle>
        <span className="text-sm text-muted">
          {t("payment.remaining")}: {formatMoney(balanceCents, locale)}
        </span>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="orderId" value={orderId} />

          {state.error && (
            <div className="sm:col-span-2">
              <Alert variant="error">{translateIssue(t, state.error)}</Alert>
            </div>
          )}
          {state.ok && state.message && (
            <div className="sm:col-span-2">
              <Alert variant="success">{translateIssue(t, state.message)}</Alert>
            </div>
          )}

          <Field
            label={t("payment.amount")}
            htmlFor="amountCents"
            required
            error={translateIssue(t, state.fieldErrors?.amountCents)}
          >
            <Input
              id="amountCents"
              name="amountCents"
              inputMode="decimal"
              defaultValue={centsToInput(balanceCents)}
              required
            />
            <Hint>{t("payment.remaining")}: {formatMoney(balanceCents, locale)}</Hint>
          </Field>

          <Field
            label={t("payment.date")}
            htmlFor="paidOn"
            required
            error={translateIssue(t, state.fieldErrors?.paidOn)}
          >
            <Input id="paidOn" name="paidOn" type="date" defaultValue={today} required />
          </Field>

          <Field
            label={t("payment.method")}
            htmlFor="method"
            required
            error={translateIssue(t, state.fieldErrors?.method)}
          >
            <Select id="method" name="method" defaultValue={defaultMethod}>
              <option value="CASH">{t("order.paymentMethod.CASH")}</option>
              <option value="BANK">{t("order.paymentMethod.BANK")}</option>
            </Select>
          </Field>

          <Field label={t("common.note")} htmlFor="note">
            <Textarea id="note" name="note" rows={1} />
          </Field>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("payment.record")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function DeletePaymentButton({
  paymentId,
  orderId,
}: {
  paymentId: string;
  orderId: string;
}) {
  const { t } = useI18n();
  return (
    <form
      action={deletePaymentAction}
      onSubmit={(event) => {
        // Deleting a payment changes a customer's debt — confirm it.
        if (!window.confirm(t("common.confirm"))) event.preventDefault();
      }}
    >
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="orderId" value={orderId} />
      <button className="text-xs text-red-600 hover:underline">{t("common.delete")}</button>
    </form>
  );
}
