"use client";

import * as React from "react";
import {
  createExpenseAction,
  createExpenseCategoryAction,
  createRecurringAction,
  deleteExpenseAction,
  deleteRecurringAction,
  generateRecurringAction,
  setExpenseCategoryActiveAction,
  updateExpenseCategoryAction,
} from "./actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { useI18n } from "@/i18n/client";
import { formatMoney } from "@/i18n";
import type { ExpenseType } from "@/db/schema";
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

interface CategoryOption {
  id: string;
  name: string;
  type: ExpenseType;
}

/** Expense entry (§9.2), with the optional receipt photo. */
export function ExpenseForm({
  categories,
  today,
}: {
  categories: CategoryOption[];
  today: string;
}) {
  const { t } = useI18n();
  const { state, pending, submit } = useFormAction(
    createExpenseAction,
    EMPTY_FORM_STATE,
  );
  const err = (f: string) => translateIssue(t, state.fieldErrors?.[f]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("expense.new")}</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-3" encType="multipart/form-data">
          {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}
          {state.ok && state.message && (
            <Alert variant="success">{translateIssue(t, state.message)}</Alert>
          )}

          <Field label={t("expense.date")} htmlFor="expenseDate" required error={err("expenseDate")}>
            <Input id="expenseDate" name="expenseDate" type="date" defaultValue={today} required />
          </Field>
          <Field
            label={t("expense.category")}
            htmlFor="categoryId"
            required
            error={err("categoryId")}
          >
            <Select id="categoryId" name="categoryId" required defaultValue="">
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t("expense.amount")}
            htmlFor="amountCents"
            required
            error={err("amountCents")}
          >
            <Input id="amountCents" name="amountCents" inputMode="decimal" required />
          </Field>
          <Field label={t("expense.method")} htmlFor="method" required error={err("method")}>
            <Select id="method" name="method" defaultValue="CASH">
              <option value="CASH">{t("order.paymentMethod.CASH")}</option>
              <option value="BANK">{t("order.paymentMethod.BANK")}</option>
            </Select>
          </Field>
          <Field label={t("expense.description")} htmlFor="description" error={err("description")}>
            <Textarea id="description" name="description" rows={2} />
          </Field>
          <Field label={t("expense.receipt")} htmlFor="receipt" error={err("receipt")}>
            <input
              id="receipt"
              name="receipt"
              type="file"
              accept="image/jpeg,image/png"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
            />
            <Hint>{t("common.optional")}</Hint>
          </Field>

          <Button type="submit" size="sm" disabled={pending}>
            {pending ? t("common.saving") : t("common.save")}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function DeleteExpenseButton({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <form
      action={deleteExpenseAction}
      onSubmit={(event) => {
        if (!window.confirm(t("common.confirm"))) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="text-xs text-red-600 hover:underline">{t("common.delete")}</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Categories (§9.1)
// ---------------------------------------------------------------------------

export function ExpenseCategoryCreateForm() {
  const { t } = useI18n();
  const { state, pending, submit } = useFormAction(
    createExpenseCategoryAction,
    EMPTY_FORM_STATE,
  );

  return (
    <CardBody>
      <form onSubmit={submit} className="space-y-3">
        {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}
        {state.ok && state.message && (
          <Alert variant="success">{translateIssue(t, state.message)}</Alert>
        )}
        <Field
          label={t("expcat.name")}
          htmlFor="cat-name"
          required
          error={translateIssue(t, state.fieldErrors?.name)}
        >
          <Input id="cat-name" name="name" required />
        </Field>
        <Field
          label={t("expcat.type")}
          htmlFor="cat-type"
          required
          error={translateIssue(t, state.fieldErrors?.type)}
        >
          <Select id="cat-type" name="type" defaultValue="VARIABLE">
            <option value="FIXED">{t("expcat.type.FIXED")}</option>
            <option value="VARIABLE">{t("expcat.type.VARIABLE")}</option>
          </Select>
          <Hint>{t("expcat.typeHint")}</Hint>
        </Field>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("common.saving") : t("common.add")}
        </Button>
      </form>
    </CardBody>
  );
}

export function ExpenseCategoryRow({
  category,
  actionsOnly,
}: {
  category: { id: string; name: string; type: ExpenseType; active: boolean };
  actionsOnly?: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = React.useState(false);
  const { state, pending, submit } = useFormAction(
    updateExpenseCategoryAction,
    EMPTY_FORM_STATE,
    { resetOnSuccess: false, onSuccess: () => setEditing(false) },
  );

  if (actionsOnly) {
    return (
      <form action={setExpenseCategoryActiveAction}>
        <input type="hidden" name="id" value={category.id} />
        <input type="hidden" name="active" value={category.active ? "false" : "true"} />
        <button className="text-xs text-muted hover:underline">
          {category.active ? t("common.archive") : t("common.restore")}
        </button>
      </form>
    );
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-medium">{category.name}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-primary hover:underline"
        >
          {t("common.edit")}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={category.id} />
      <Input
        name="name"
        defaultValue={category.name}
        required
        autoFocus
        className="h-8 max-w-44 py-1 text-sm"
        aria-invalid={Boolean(state.fieldErrors?.name)}
      />
      <Select name="type" defaultValue={category.type} className="h-8 max-w-32 py-1 text-sm">
        <option value="FIXED">{t("expcat.type.FIXED")}</option>
        <option value="VARIABLE">{t("expcat.type.VARIABLE")}</option>
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        {t("common.save")}
      </Button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-xs text-muted hover:underline"
      >
        {t("common.cancel")}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Recurring templates (§9.3)
// ---------------------------------------------------------------------------

export function RecurringCreateForm({ categories }: { categories: CategoryOption[] }) {
  const { t } = useI18n();
  const { state, pending, submit } = useFormAction(
    createRecurringAction,
    EMPTY_FORM_STATE,
  );
  const err = (f: string) => translateIssue(t, state.fieldErrors?.[f]);

  return (
    <CardBody>
      <form onSubmit={submit} className="space-y-3">
        {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}
        {state.ok && state.message && (
          <Alert variant="success">{translateIssue(t, state.message)}</Alert>
        )}
        <Field label={t("expense.category")} htmlFor="r-cat" required error={err("categoryId")}>
          <Select id="r-cat" name="categoryId" required defaultValue="">
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("expense.amount")} htmlFor="r-amount" required error={err("amountCents")}>
          <Input id="r-amount" name="amountCents" inputMode="decimal" required />
        </Field>
        <Field label={t("expense.method")} htmlFor="r-method" required error={err("method")}>
          <Select id="r-method" name="method" defaultValue="BANK">
            <option value="CASH">{t("order.paymentMethod.CASH")}</option>
            <option value="BANK">{t("order.paymentMethod.BANK")}</option>
          </Select>
        </Field>
        <Field label={t("expense.description")} htmlFor="r-desc" error={err("description")}>
          <Input id="r-desc" name="description" />
        </Field>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("common.saving") : t("common.add")}
        </Button>
      </form>
    </CardBody>
  );
}

export function GenerateRecurringButton({
  month,
  templateCount,
  totalCents,
}: {
  month: string;
  templateCount: number;
  totalCents: number;
}) {
  const { t, locale } = useI18n();
  const { state, pending, submit } = useFormAction(
    generateRecurringAction,
    EMPTY_FORM_STATE,
    { resetOnSuccess: false },
  );

  return (
    <div className="space-y-3">
      {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}
      {state.ok && state.message && (
        <Alert variant="success">{translateIssue(t, state.message)}</Alert>
      )}
      <form
        onSubmit={(event) => {
          if (
            !window.confirm(
              t("recur.generateConfirm", { count: templateCount, month }),
            )
          ) {
            event.preventDefault();
            return;
          }
          submit(event);
        }}
        className="flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="month" value={month} />
        <Button type="submit" disabled={pending || templateCount === 0}>
          {pending ? t("common.saving") : t("recur.generate")}
        </Button>
        <span className="text-sm text-muted tabular-nums">
          {month} · {templateCount} · {formatMoney(totalCents, locale)}
        </span>
      </form>
    </div>
  );
}

export function DeleteRecurringButton({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <form action={deleteRecurringAction}>
      <input type="hidden" name="id" value={id} />
      <button className="text-xs text-red-600 hover:underline">{t("common.delete")}</button>
    </form>
  );
}
