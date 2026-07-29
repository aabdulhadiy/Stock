"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useT } from "@/i18n/client";
import { Alert, Button, Card, CardBody, Field, Input } from "@/components/ui";

export function LoginForm({ from }: { from: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(loginAction, EMPTY_FORM_STATE);

  return (
    <Card>
      <CardBody>
        <form action={action} className="space-y-4">
          <input type="hidden" name="from" value={from} />

          {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}

          <Field
            label={t("auth.login")}
            htmlFor="login"
            required
            error={translateIssue(t, state.fieldErrors?.login)}
          >
            <Input
              id="login"
              name="login"
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              required
              aria-invalid={Boolean(state.fieldErrors?.login)}
            />
          </Field>

          <Field
            label={t("auth.password")}
            htmlFor="password"
            required
            error={translateIssue(t, state.fieldErrors?.password)}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={Boolean(state.fieldErrors?.password)}
            />
          </Field>

          <Button type="submit" className="w-full" size="lg" disabled={pending}>
            {pending ? t("common.loading") : t("auth.signIn")}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
