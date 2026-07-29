import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type Role } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/lib/password";
import { LOCALE_COOKIE } from "@/i18n/config";
import {
  SESSION_COOKIE,
  cookieOptions,
  signSession,
  verifySessionToken,
  type SessionUser,
} from "@/lib/session";
import type { Actor } from "@/lib/permissions";

/**
 * The Data Access Layer for authentication. Every page, server action and
 * route handler starts here — the Next.js docs are explicit that Server
 * Functions are reachable by direct POST and that proxy coverage is not a
 * substitute for checking inside each one.
 */

export { hashPassword, verifyPassword };

export type AuthFailure = "INVALID" | "DISABLED" | "ROLE_DISABLED";

/** Validate credentials and return a session payload, or a reason it failed. */
export async function authenticate(
  login: string,
  password: string,
): Promise<{ user: SessionUser } | { error: AuthFailure }> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.login, login.toLowerCase().trim()));

  // Always run a comparison so a missing login and a wrong password take a
  // similar amount of time — no free user-enumeration oracle.
  const passwordOk = await verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);

  if (!row || !passwordOk) return { error: "INVALID" };
  if (!row.active) return { error: "DISABLED" };

  const settings = await getSettings();
  if (row.role === "SALESPERSON" && !settings.salespersonEnabled) {
    return { error: "ROLE_DISABLED" };
  }

  return {
    user: {
      sub: row.id,
      login: row.login,
      name: row.name,
      role: row.role,
      locale: row.locale,
      ttl: Math.max(1, settings.sessionTimeoutHours) * 3600,
    },
  };
}

/** Issue the session cookie, plus the locale cookie used for rendering. */
export async function createSession(user: SessionUser): Promise<void> {
  const token = await signSession(user);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(user.ttl));
  store.set(LOCALE_COOKIE, user.locale, {
    ...cookieOptions(60 * 60 * 24 * 365),
    httpOnly: false, // read by nothing sensitive; kept simple and long-lived
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Current user, or null. Memoized per render pass so a page that guards in
 * several components still performs one cookie read and one verify.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
});

/** Require a signed-in user; redirect to /login otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Require one of the given roles. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

export async function requireDirector(): Promise<SessionUser> {
  return requireRole("DIRECTOR");
}

/** The permission-check subject for the current user. */
export function toActor(user: SessionUser): Actor {
  return { id: user.sub, role: user.role };
}

export async function requireActor(): Promise<{ user: SessionUser; actor: Actor }> {
  const user = await requireUser();
  return { user, actor: toActor(user) };
}

/**
 * Guard for server actions. Unlike the page guards this THROWS rather than
 * redirecting, so a forbidden mutation fails loudly instead of quietly
 * rendering a different page.
 */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function authorize(
  check: (actor: Actor) => boolean,
): Promise<{ user: SessionUser; actor: Actor }> {
  const user = await getCurrentUser();
  if (!user) throw new ForbiddenError("Not signed in");
  const actor = toActor(user);
  if (!check(actor)) throw new ForbiddenError();
  return { user, actor };
}

/** Keep the rendering locale cookie in step with a saved user preference. */
export async function setLocaleCookie(locale: string): Promise<void> {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    ...cookieOptions(60 * 60 * 24 * 365),
    httpOnly: false,
  });
}

/** Re-issue the session token, e.g. after the user changes their language. */
export async function refreshSession(patch: Partial<SessionUser>): Promise<void> {
  const current = await getCurrentUser();
  if (!current) return;
  const next = { ...current, ...patch };
  const token = await signSession(next);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(next.ttl));
}
