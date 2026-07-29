"use client";

import * as React from "react";
import { setLocaleAction } from "@/app/(app)/actions";
import { LOCALES, LOCALE_NAMES, LOCALE_SHORT, type LocaleCode } from "@/i18n/config";
import { useLocale } from "@/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Header language switcher (§13). Each language is a form posting to a Server
 * Action that rewrites the locale cookie; Next.js then re-renders the current
 * page and its layouts, and React keeps the state of mounted client components
 * — so switching language mid-form does not lose what has been typed.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const current = useLocale();
  const [pending, startTransition] = React.useTransition();

  const pick = (locale: LocaleCode) => {
    if (locale === current) return;
    const data = new FormData();
    data.set("locale", locale);
    startTransition(() => {
      void setLocaleAction(data);
    });
  };

  return (
    <div
      className={cn(
        "inline-flex rounded-md border border-border bg-surface p-0.5",
        pending && "opacity-60",
        className,
      )}
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => pick(locale)}
          aria-pressed={locale === current}
          title={LOCALE_NAMES[locale]}
          className={cn(
            "px-2 py-1 text-xs font-semibold rounded transition-colors",
            locale === current
              ? "bg-primary text-primary-foreground"
              : "text-muted hover:bg-slate-100",
          )}
        >
          {LOCALE_SHORT[locale]}
        </button>
      ))}
    </div>
  );
}
