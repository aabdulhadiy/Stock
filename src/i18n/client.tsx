"use client";

import * as React from "react";
import { translator, type T, type TranslationKey, type TranslateParams } from "./index";
import { DEFAULT_LOCALE, type LocaleCode } from "./config";

/**
 * Client-side translation. The provider is seeded from the server with the
 * current locale, so client components render the right language on first
 * paint. Only the active dictionary is used, so switching relies on the server
 * re-render (see `LocaleSwitcher`) rather than shipping all three dictionaries.
 */

interface LocaleContextValue {
  locale: LocaleCode;
  t: T;
}

const LocaleContext = React.createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  t: translator(DEFAULT_LOCALE),
});

export function LocaleProvider({
  locale,
  children,
}: {
  locale: LocaleCode;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ locale, t: translator(locale) }),
    [locale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Translator for client components. */
export function useT(): T {
  return React.useContext(LocaleContext).t;
}

export function useLocale(): LocaleCode {
  return React.useContext(LocaleContext).locale;
}

/** Both, for components that also format numbers or dates. */
export function useI18n(): LocaleContextValue {
  return React.useContext(LocaleContext);
}

export type { TranslationKey, TranslateParams };
