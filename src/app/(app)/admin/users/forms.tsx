"use client";

import * as React from "react";
import {
  createUserAction,
  setUserActiveAction,
  updateUserAction,
} from "./actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { useT } from "@/i18n/client";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import type { Locale, Role } from "@/db/schema";
import {
  Alert,
  Button,
  CardBody,
  Field,
  Hint,
  Input,
  Select,
} from "@/components/ui";
import { roleKey } from "@/lib/labels";

const ROLES: Role[] = ["DIRECTOR", "WAREHOUSEMAN", "SALESPERSON"];

export function UserCreateForm() {
  const t = useT();
  // Clears itself on success so the next user can be entered straight away.
  const { state, pending, submit } = useFormAction(
    createUserAction,
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

        <Field label={t("user.name")} htmlFor="u-name" required error={err("name")}>
          <Input id="u-name" name="name" required />
        </Field>
        <Field label={t("user.login")} htmlFor="u-login" required error={err("login")}>
          <Input id="u-login" name="login" autoCapitalize="none" required className="font-mono" />
        </Field>
        <Field label={t("user.role")} htmlFor="u-role" required error={err("role")}>
          <Select id="u-role" name="role" defaultValue="WAREHOUSEMAN">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(roleKey(r))}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("user.locale")} htmlFor="u-locale" required error={err("locale")}>
          <Select id="u-locale" name="locale" defaultValue="UZ">
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("user.password")} htmlFor="u-password" required error={err("password")}>
          <Input id="u-password" name="password" type="password" required minLength={8} />
          <Hint>{t("user.passwordHint")}</Hint>
        </Field>

        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("common.saving") : t("common.create")}
        </Button>
      </form>
    </CardBody>
  );
}

export function UserRowActions({
  user,
  isSelf,
}: {
  user: {
    id: string;
    name: string;
    login: string;
    role: Role;
    locale: Locale;
    active: boolean;
  };
  isSelf: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = React.useState(false);
  const { state, pending, submit } = useFormAction(updateUserAction, EMPTY_FORM_STATE, {
    resetOnSuccess: false,
    onSuccess: () => setEditing(false),
  });
  const err = (f: string) => translateIssue(t, state.fieldErrors?.[f]);

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-primary hover:underline"
        >
          {t("common.edit")}
        </button>
        {/* Never offer to deactivate the account you are signed in with. */}
        {!isSelf && (
          <form action={setUserActiveAction}>
            <input type="hidden" name="id" value={user.id} />
            <input type="hidden" name="active" value={user.active ? "false" : "true"} />
            <button className="text-xs text-muted hover:underline">
              {user.active ? t("common.archive") : t("common.restore")}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="min-w-64 space-y-2 py-1">
      <input type="hidden" name="id" value={user.id} />
      {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}

      <Input name="name" defaultValue={user.name} required aria-label={t("user.name")} />
      {err("name") && <p className="text-xs text-red-600">{err("name")}</p>}

      <Input
        name="login"
        defaultValue={user.login}
        required
        aria-label={t("user.login")}
        className="font-mono"
      />
      {err("login") && <p className="text-xs text-red-600">{err("login")}</p>}

      <Select name="role" defaultValue={user.role} aria-label={t("user.role")} disabled={isSelf}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {t(roleKey(r))}
          </option>
        ))}
      </Select>
      {/* A disabled select submits nothing, so keep the value for self-edits. */}
      {isSelf && <input type="hidden" name="role" value={user.role} />}

      <Select name="locale" defaultValue={user.locale} aria-label={t("user.locale")}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </Select>

      <Input
        name="password"
        type="password"
        placeholder={t("user.passwordKeep")}
        aria-label={t("auth.newPassword")}
      />
      {err("password") && <p className="text-xs text-red-600">{err("password")}</p>}

      <div className="flex items-center gap-2">
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
      </div>
    </form>
  );
}
