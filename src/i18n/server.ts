import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { coerceLocale, LOCALE_COOKIE, type LocaleCode } from "./config";
import { translator, type T } from "./index";

/**
 * Server-side locale resolution. The cookie is the source of truth for
 * rendering: it is written at sign-in from the user's stored preference and
 * updated by the header switcher, so the switch takes effect on the very next
 * render without a database round trip.
 *
 * Wrapped in React `cache` so every server component in one render pass shares
 * a single cookie read.
 */
export const getLocale = cache(async (): Promise<LocaleCode> => {
  const store = await cookies();
  return coerceLocale(store.get(LOCALE_COOKIE)?.value);
});

/** The translator for the current request. */
export const getT = cache(async (): Promise<T> => {
  return translator(await getLocale());
});

/** Both, when a component needs the locale for number/date formatting too. */
export async function getI18n(): Promise<{ locale: LocaleCode; t: T }> {
  const locale = await getLocale();
  return { locale, t: translator(locale) };
}
