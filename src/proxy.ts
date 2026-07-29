import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  cookieOptions,
  shouldRenew,
  signSession,
  verifySessionToken,
} from "@/lib/session";
import { isPathAllowed } from "@/lib/permissions";

/**
 * Coarse auth + role gate (Next 16 renamed `middleware` to `proxy`).
 *
 * This is an *optimistic* check that only reads the signed cookie — no database
 * work, as the Next.js docs advise, because it runs on every request including
 * prefetches. It is not the security boundary: every page guards with
 * `requireUser`/`requireRole` and every Server Action re-checks with
 * `authorize`, because Server Actions are reachable by direct POST.
 *
 * It also slides the §2.3 inactivity window forward while the user is active.
 */

const PUBLIC_PATHS = new Set(["/login"]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  if (PUBLIC_PATHS.has(pathname)) {
    // Already signed in? Skip the login form.
    return session
      ? NextResponse.redirect(new URL("/dashboard", req.url))
      : NextResponse.next();
  }

  if (!session) {
    const url = new URL("/login", req.url);
    // Remember where they were headed, so sign-in can return them there.
    if (pathname !== "/") url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  if (!isPathAllowed(pathname, session.role)) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  const res = NextResponse.next();

  // Inactivity timeout: extend the cookie while the user keeps working, so the
  // session expires N hours after their *last* request, not after sign-in.
  if (shouldRenew(session)) {
    const { exp: _exp, ...user } = session;
    res.cookies.set(
      SESSION_COOKIE,
      await signSession(user),
      cookieOptions(session.ttl),
    );
  }

  return res;
}

export const config = {
  // Skip Next internals and static assets; without this the gate would also
  // block CSS and images. `/api/health` stays public for container health checks.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|uploads|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)",
  ],
};
