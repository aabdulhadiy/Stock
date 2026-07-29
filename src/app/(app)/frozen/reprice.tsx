"use client";

import * as React from "react";
import { repriceProductAction } from "./actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { useI18n } from "@/i18n/client";
import { formatMoney } from "@/i18n";
import { centsToInput } from "@/lib/money";
import { Button, Input } from "@/components/ui";

/** Inline reprice control on the frozen-stock list (§4.3). */
export function RepriceForm({
  productId,
  name,
  marketPriceCents,
  exportPriceCents,
}: {
  productId: string;
  name: string;
  marketPriceCents: number;
  exportPriceCents: number;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = React.useState(false);
  const { state, pending, submit } = useFormAction(
    repriceProductAction,
    EMPTY_FORM_STATE,
    { resetOnSuccess: false, onSuccess: () => setOpen(false) },
  );

  if (!open) {
    return (
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-left text-xs font-medium text-primary hover:underline"
        >
          {t("frozen.reprice")}
        </button>
        <span className="text-[11px] tabular-nums text-muted">
          {formatMoney(marketPriceCents, locale)} / {formatMoney(exportPriceCents, locale)}
        </span>
        {state.ok && state.message && (
          <span className="text-[11px] text-emerald-700">
            {translateIssue(t, state.message)}
          </span>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="min-w-56 space-y-1.5">
      <input type="hidden" name="id" value={productId} />
      <p className="text-[11px] font-medium text-muted">
        {t("frozen.repriceTitle", { name })}
      </p>

      <label className="block text-[11px] text-muted">
        {t("product.marketPrice")}
        <Input
          name="marketPriceCents"
          inputMode="decimal"
          defaultValue={centsToInput(marketPriceCents)}
          required
          className="h-8 py-1 text-right text-sm"
          aria-invalid={Boolean(state.fieldErrors?.marketPriceCents)}
        />
      </label>
      <label className="block text-[11px] text-muted">
        {t("product.exportPrice")}
        <Input
          name="exportPriceCents"
          inputMode="decimal"
          defaultValue={centsToInput(exportPriceCents)}
          required
          className="h-8 py-1 text-right text-sm"
          aria-invalid={Boolean(state.fieldErrors?.exportPriceCents)}
        />
      </label>

      {state.error && (
        <p className="text-[11px] text-red-600">{translateIssue(t, state.error)}</p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:underline"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
