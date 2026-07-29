/**
 * i18n configuration (§13). Three UI languages, Uzbek (Latin) default.
 *
 * Adding a fourth language is: add the code here, add one resource file under
 * `locales/`, register it in `dictionaries` (i18n/index.ts). No other code
 * changes — that is the §13 requirement.
 */

export const LOCALES = ["UZ", "RU", "EN"] as const;
export type LocaleCode = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: LocaleCode = "UZ";

/** Cookie that carries the choice for anonymous visitors and page renders. */
export const LOCALE_COOKIE = "locale";

export const LOCALE_NAMES: Record<LocaleCode, string> = {
  UZ: "O'zbekcha",
  RU: "Русский",
  EN: "English",
};

/** Short label for the header switcher. */
export const LOCALE_SHORT: Record<LocaleCode, string> = {
  UZ: "UZ",
  RU: "RU",
  EN: "EN",
};

/** BCP-47 tags, used for Intl number/date formatting. */
export const LOCALE_TAGS: Record<LocaleCode, string> = {
  UZ: "uz-Latn-UZ",
  RU: "ru-RU",
  EN: "en-US",
};

export function isLocale(value: unknown): value is LocaleCode {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function coerceLocale(value: unknown): LocaleCode {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
