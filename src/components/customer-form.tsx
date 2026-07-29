"use client";

import * as React from "react";
import Link from "next/link";
import {
  createCustomerAction,
  updateCustomerAction,
} from "@/app/(app)/customers/actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { useT } from "@/i18n/client";
import { CHANNELS, PAYMENT_TERMS, priceTypeForChannel } from "@/lib/validation";
import { channelKey, paymentTermLabel } from "@/lib/labels";
import type { Channel, PriceType } from "@/db/schema";
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

export interface CustomerFormValues {
  id?: string;
  name: string;
  phone: string;
  city: string | null;
  channel: Channel;
  defaultPriceType: PriceType;
  defaultTermDays: number | null;
  note: string | null;
}

/**
 * Customer card (§8.1). Choosing a channel suggests the default price type —
 * Export for the Export channel, Market for everything else — which the
 * Director may override.
 */
export function CustomerForm({
  mode,
  values,
}: {
  mode: "create" | "edit";
  values?: CustomerFormValues;
}) {
  const t = useT();
  const { state, pending, submit } = useFormAction(
    mode === "create" ? createCustomerAction : updateCustomerAction,
    EMPTY_FORM_STATE,
    { resetOnSuccess: false },
  );

  const [channel, setChannel] = React.useState<Channel>(values?.channel ?? "DOMESTIC");
  const [priceType, setPriceType] = React.useState<PriceType>(
    values?.defaultPriceType ?? "MARKET",
  );
  // Once the user picks a price type explicitly, changing the channel leaves it.
  const [pinned, setPinned] = React.useState(mode === "edit");

  const onChannelChange = (next: Channel) => {
    setChannel(next);
    if (!pinned) setPriceType(priceTypeForChannel(next));
  };

  const err = (field: string) => translateIssue(t, state.fieldErrors?.[field]);

  return (
    <form onSubmit={submit} className="space-y-5">
      {values?.id && <input type="hidden" name="id" value={values.id} />}

      {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}
      {state.ok && state.message && (
        <Alert variant="success">{translateIssue(t, state.message)}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{mode === "create" ? t("customer.new") : t("customer.edit")}</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t("customer.name")} htmlFor="name" required error={err("name")}>
            <Input id="name" name="name" defaultValue={values?.name} required />
          </Field>
          <Field label={t("customer.phone")} htmlFor="phone" required error={err("phone")}>
            <Input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={values?.phone}
              required
            />
          </Field>
          <Field label={t("customer.city")} htmlFor="city" error={err("city")}>
            <Input id="city" name="city" defaultValue={values?.city ?? ""} />
          </Field>
          <Field
            label={t("customer.channel")}
            htmlFor="channel"
            required
            error={err("channel")}
          >
            <Select
              id="channel"
              name="channel"
              value={channel}
              onChange={(e) => onChannelChange(e.target.value as Channel)}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(channelKey(c))}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t("customer.defaultPriceType")}
            htmlFor="defaultPriceType"
            required
            error={err("defaultPriceType")}
          >
            <Select
              id="defaultPriceType"
              name="defaultPriceType"
              value={priceType}
              onChange={(e) => {
                setPriceType(e.target.value as PriceType);
                setPinned(true);
              }}
            >
              <option value="MARKET">{t("order.priceType.MARKET")}</option>
              <option value="EXPORT">{t("order.priceType.EXPORT")}</option>
            </Select>
            <Hint>{t("customer.defaultPriceTypeHint")}</Hint>
          </Field>
          <Field
            label={t("customer.defaultTerm")}
            htmlFor="defaultTermDays"
            error={err("defaultTermDays")}
          >
            <Select
              id="defaultTermDays"
              name="defaultTermDays"
              defaultValue={String(values?.defaultTermDays ?? 0)}
            >
              {PAYMENT_TERMS.map((d) => (
                <option key={d} value={d}>
                  {paymentTermLabel(t, d)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t("common.note")}
            htmlFor="note"
            error={err("note")}
            className="sm:col-span-2"
          >
            <Textarea id="note" name="note" rows={2} defaultValue={values?.note ?? ""} />
          </Field>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
        <Link
          href={values?.id ? `/customers/${values.id}` : "/customers"}
          className="text-sm text-muted hover:underline"
        >
          {t("common.cancel")}
        </Link>
      </div>
    </form>
  );
}
