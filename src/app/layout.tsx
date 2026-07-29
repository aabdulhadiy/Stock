import type { Metadata } from "next";
import "./globals.css";
import { getLocale } from "@/i18n/server";
import { LOCALE_TAGS } from "@/i18n/config";
import { LocaleProvider } from "@/i18n/client";

export const metadata: Metadata = {
  title: "Warehouse & Sales",
  description: "Warehouse and sales management for a toy manufacturing factory",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The locale comes from a cookie, so the whole tree renders in the user's
  // language on the first paint — and a language switch (which rewrites that
  // cookie in a Server Action) re-renders the tree while React preserves the
  // state of client components, i.e. unsaved form input (§13).
  const locale = await getLocale();
  return (
    <html lang={LOCALE_TAGS[locale]}>
      <body className="antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
