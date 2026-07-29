"use client";

import * as React from "react";
import {
  createCategoryAction,
  renameCategoryAction,
  setCategoryActiveAction,
} from "../actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { useT } from "@/i18n/client";
import { Alert, Button, CardBody, Field, Input } from "@/components/ui";

export function CategoryCreateForm() {
  const t = useT();
  // The hook clears the field on success so the next category can be typed
  // straight away.
  const { state, pending, submit } = useFormAction(
    createCategoryAction,
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
          label={t("category.name")}
          htmlFor="new-category"
          required
          error={translateIssue(t, state.fieldErrors?.name)}
        >
          <Input id="new-category" name="name" required />
        </Field>
        <Button type="submit" disabled={pending} size="sm">
          {pending ? t("common.saving") : t("common.add")}
        </Button>
      </form>
    </CardBody>
  );
}

/**
 * One row: either the inline rename form, or the archive/restore action.
 * Rendered twice per row (name cell and actions cell) via `actionsOnly`.
 */
export function CategoryRow({
  id,
  name,
  active,
  actionsOnly,
}: {
  id: string;
  name: string;
  active?: boolean;
  actionsOnly?: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = React.useState(false);
  const { state, pending, submit } = useFormAction(
    renameCategoryAction,
    EMPTY_FORM_STATE,
    { resetOnSuccess: false, onSuccess: () => setEditing(false) },
  );

  if (actionsOnly) {
    return (
      <form action={setCategoryActiveAction} className="flex gap-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={active ? "false" : "true"} />
        <button className="text-xs text-muted hover:underline">
          {active ? t("common.archive") : t("common.restore")}
        </button>
      </form>
    );
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-medium">{name}</span>
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
    <form onSubmit={submit} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input
        name="name"
        defaultValue={name}
        required
        autoFocus
        className="h-8 max-w-52 py-1 text-sm"
        aria-invalid={Boolean(state.fieldErrors?.name)}
      />
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
