import bcrypt from "bcryptjs";

/**
 * Password hashing, kept free of any Next.js imports so scripts (seed, CLI
 * tooling) can use it outside the request runtime. §2.3: passwords are stored
 * hashed with bcrypt.
 */

/** Cost factor. 12 is ~250ms on the target VPS — slow for attackers, fine for login. */
const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A syntactically valid bcrypt hash that matches nothing. Compared against when
 * a login does not exist, so a missing user and a wrong password take a similar
 * amount of time and cannot be told apart by timing.
 */
export const DUMMY_HASH =
  "$2a$12$abcdefghijklmnopqrstuv012345678901234567890123456789012";

export const MIN_PASSWORD_LENGTH = 8;
