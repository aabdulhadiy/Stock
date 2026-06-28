import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { SECTION_ROLES } from "@/lib/permissions";

const PUBLIC_PATHS = ["/login"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await verifySessionToken(token);

  // Signed-in users hitting /login go to the dashboard.
  if (user && PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  // Everything else requires a session.
  if (!user) {
    const url = new URL("/login", req.url);
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // Coarse role gate per top-level section (fine-grained checks live in actions).
  for (const [prefix, roles] of Object.entries(SECTION_ROLES)) {
    if (pathname.startsWith(prefix) && !roles.includes(user.role)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except Next internals, the API auth route, and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
