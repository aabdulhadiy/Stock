"use client";

import { useActionState } from "react";
import { saveSettingsAction } from "./actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useT } from "@/i18n/client";
import type { AppSettings } from "@/lib/settings";
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
} from "@/components/ui";

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveSettingsAction, EMPTY_FORM_STATE);
  const err = (field: string) => translateIssue(t, state.fieldErrors?.[field]);

  return (
    <form action={action} className="space-y-5">
      {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}
      {state.ok && state.message && (
        <Alert variant="success">{translateIssue(t, state.message)}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.stockThresholds")}</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("settings.slowDays")}
            htmlFor="slowDays"
            required
            error={err("slowDays")}
          >
            <Input
              id="slowDays"
              name="slowDays"
              inputMode="numeric"
              defaultValue={settings.slowDays}
              required
            />
          </Field>
          <Field
            label={t("settings.frozenDays")}
            htmlFor="frozenDays"
            required
            error={err("frozenDays")}
          >
            <Input
              id="frozenDays"
              name="frozenDays"
              inputMode="numeric"
              defaultValue={settings.frozenDays}
              required
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.xyz")}</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("settings.xyzX")}
            htmlFor="xyzXMaxPct"
            required
            error={err("xyzXMaxPct")}
          >
            <Input
              id="xyzXMaxPct"
              name="xyzXMaxPct"
              inputMode="numeric"
              defaultValue={settings.xyzXMaxPct}
              required
            />
          </Field>
          <Field
            label={t("settings.xyzY")}
            htmlFor="xyzYMaxPct"
            required
            error={err("xyzYMaxPct")}
          >
            <Input
              id="xyzYMaxPct"
              name="xyzYMaxPct"
              inputMode="numeric"
              defaultValue={settings.xyzYMaxPct}
              required
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.general")}</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("settings.uzsRate")}
            htmlFor="uzsPerUsd"
            required
            error={err("uzsPerUsd")}
            hint={t("settings.uzsRateHint")}
          >
            <Input
              id="uzsPerUsd"
              name="uzsPerUsd"
              inputMode="numeric"
              defaultValue={settings.uzsPerUsd}
              required
            />
          </Field>
          <Field
            label={t("settings.sessionTimeout")}
            htmlFor="sessionTimeoutHours"
            required
            error={err("sessionTimeoutHours")}
          >
            <Input
              id="sessionTimeoutHours"
              name="sessionTimeoutHours"
              inputMode="numeric"
              defaultValue={settings.sessionTimeoutHours}
              required
            />
          </Field>
          <Field
            label={t("settings.orderNumberFormat")}
            htmlFor="orderNumberFormat"
            required
            error={err("orderNumberFormat")}
            hint={t("settings.orderNumberHint")}
            className="sm:col-span-2"
          >
            <Input
              id="orderNumberFormat"
              name="orderNumberFormat"
              defaultValue={settings.orderNumberFormat}
              required
              className="font-mono"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.salesperson")}</CardTitle>
        </CardHeader>
        <CardBody>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="salespersonEnabled"
              defaultChecked={settings.salespersonEnabled}
              className="mt-0.5 size-4 rounded border-border"
            />
            <span>
              {t("settings.salespersonEnabled")}
              <Hint>{t("settings.salespersonHint")}</Hint>
            </span>
          </label>
        </CardBody>
      </Card>

      <Button type="submit" disabled={pending}>
        {pending ? t("common.saving") : t("common.saveChanges")}
      </Button>
    </form>
  );
}
