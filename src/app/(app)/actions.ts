"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  destroySession,
  getCurrentUser,
  refreshSession,
  setLocaleCookie,
} from "@/lib/auth";
import { coerceLocale } from "@/i18n/config";

/** Shell-level actions: signing out and switching language. */

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/**
 * Switch the UI language (§13). Writes the rendering cookie, persists the
 * choice on the user record, and re-issues the session token so the preference
 * survives a sign-out.
 *
 * No `redirect` here on purpose: setting a cookie in a Server Action already
 * makes Next.js re-render the current page and its layouts, and that path
 * preserves client component state — so a half-filled form is still there in
 * the new language.
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = coerceLocale(formData.get("locale"));
  await setLocaleCookie(locale);

  const user = await getCurrentUser();
  if (user) {
    await db.update(users).set({ locale }).where(eq(users.id, user.sub));
    await refreshSession({ locale });
  }

  // Re-render every route segment so server-rendered strings switch too.
  revalidatePath("/", "layout");
}
