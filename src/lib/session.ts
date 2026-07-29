import { SignJWT, jwtVerify } from "jose";
import type { Role, Locale } from "@/db/schema";

/**
 * Session primitives: sign/verify only — no DB and no `next/headers` — so this
 * module can be imported from `proxy.ts` as well as from server actions.
 *
 * Sessions are HS256 JWTs in an httpOnly cookie. §2.3 asks for an *inactivity*
 * timeout, so the token carries its own TTL and `proxy.ts` slides the expiry
 * forward while the user keeps browsing (see `shouldRenew`).
 */

export const SESSION_COOKIE = "session";

/** Fallback when a token predates a settings change (§2.3 default is 12 h). */
export const DEFAULT_TIMEOUT_HOURS = 12;

export interface SessionUser {
  sub: string; // user id
  login: string;
  name: string;
  role: Role;
  locale: Locale;
  /** Inactivity window in seconds, copied from Settings at sign time. */
  ttl: number;
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  if (value.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters long");
  }
  return new TextEncoder().encode(value);
}

export async function signSession(user: SessionUser): Promise<string> {
  const ttl = user.ttl > 0 ? user.ttl : DEFAULT_TIMEOUT_HOURS * 3600;
  return new SignJWT({ ...user, ttl })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secret());
}

export interface VerifiedSession extends SessionUser {
  /** Unix seconds at which this token expires. */
  exp: number;
}

export async function verifySessionToken(
  token: string | undefined,
): Promise<VerifiedSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      login: String(payload.login ?? ""),
      name: String(payload.name ?? ""),
      role: payload.role as Role,
      locale: (payload.locale as Locale) ?? "UZ",
      ttl: Number(payload.ttl) || DEFAULT_TIMEOUT_HOURS * 3600,
      exp: Number(payload.exp) || 0,
    };
  } catch {
    // Expired, tampered with, or signed with a rotated secret — all "no session".
    return null;
  }
}

/**
 * True once more than half the inactivity window has elapsed. Renewing on every
 * request would rewrite the cookie constantly; renewing at the halfway point
 * keeps "N hours of inactivity signs you out" true without the churn.
 */
export function shouldRenew(session: VerifiedSession, now = Date.now()): boolean {
  const remaining = session.exp - Math.floor(now / 1000);
  return remaining < session.ttl / 2;
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    // §14 requires HTTPS in production; the cookie must not travel in clear.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
