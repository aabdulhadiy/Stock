import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@/db/schema";

/**
 * Edge-safe session primitives (sign/verify only — no DB, no next/headers),
 * so this module can be imported from middleware. Sessions are JWTs (HS256)
 * stored in an httpOnly cookie. This is intentionally thin so it can be
 * realigned to Pixly's auth pattern later with minimal churn.
 */

export const SESSION_COOKIE = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionUser {
  sub: string; // user id
  email: string;
  name: string;
  role: Role;
  shopId: string | null;
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(value);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifySessionToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      sub: payload.sub as string,
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as Role,
      shopId: (payload.shopId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = MAX_AGE_SECONDS;
