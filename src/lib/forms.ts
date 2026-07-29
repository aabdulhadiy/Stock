import type { ZodError } from "zod";
import type { T, TranslationKey } from "@/i18n";

/**
 * Shared server-action result shape, and the bridge between validation and the
 * translated UI.
 *
 * §13 requires validation messages to be translated, so schemas never carry
 * English text — they carry a translation key, optionally with parameters:
 *
 *     "valid.required"
 *     "valid.minLength|min:8"
 *
 * `translateIssue` turns that back into a sentence in the user's language.
 */

export interface FormState {
  ok?: boolean;
  /** A translation key (optionally encoded with parameters). */
  error?: string;
  /** Field name -> encoded translation key. */
  fieldErrors?: Record<string, string>;
  /** Set on success, so the UI can show a confirmation. */
  message?: string;
}

export const EMPTY_FORM_STATE: FormState = {};

/** Encode a message key with parameters, for use inside a zod schema. */
export function msg(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  if (!params) return key;
  const parts = Object.entries(params).map(([k, v]) => `${k}:${v}`);
  return `${key}|${parts.join(",")}`;
}

/** Decode and translate an encoded message. */
export function translateIssue(t: T, encoded: string | undefined): string {
  if (!encoded) return "";
  const [key, rawParams] = encoded.split("|");
  if (!rawParams) return t(key as TranslationKey);

  const params: Record<string, string> = {};
  for (const pair of rawParams.split(",")) {
    const idx = pair.indexOf(":");
    if (idx > 0) params[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return t(key as TranslationKey, params);
}

/** First error per field, keyed by dotted path. */
export function zodToFieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Turn a thrown error into a FormState. Deliberately opaque about internals —
 * §14 asks for a clear error with no silent data loss, not a stack trace.
 */
export function toFormError(error: unknown): FormState {
  if (error instanceof Error && error.name === "ForbiddenError") {
    return { error: "auth.noAccess" };
  }
  return { error: "common.unexpectedError" };
}
