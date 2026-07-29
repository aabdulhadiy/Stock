"use server";

import { redirect } from "next/navigation";
import { authenticate, createSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { loginSchema } from "@/lib/validation";
import { zodToFieldErrors, type FormState } from "@/lib/forms";

/** Sign in (§2.3). Returns translation keys; the form renders them. */
export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    login: String(formData.get("login") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const result = await authenticate(parsed.data.login, parsed.data.password);
  if ("error" in result) {
    switch (result.error) {
      case "DISABLED":
        return { error: "auth.accountDisabled" };
      case "ROLE_DISABLED":
        return { error: "user.salespersonDisabled" };
      default:
        return { error: "auth.invalidCredentials" };
    }
  }

  await createSession(result.user);
  await writeAudit({
    userId: result.user.sub,
    entity: "user",
    entityId: result.user.sub,
    action: "login",
    label: result.user.login,
  });

  // Only follow same-origin relative paths, so `?from=` cannot be used as an
  // open redirect.
  const from = String(formData.get("from") ?? "");
  const target = /^\/(?!\/)[\w\-/[\]]*$/.test(from) ? from : "/dashboard";

  // Outside the try/catch and last: redirect throws a control-flow signal.
  redirect(target);
}
