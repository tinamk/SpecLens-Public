import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE = "speclens_portal_session";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/portal")) {
    const session = request.cookies.get(SESSION_COOKIE)?.value;
    if (!session) {
      const loginUrl = new URL("/api/auth/login", request.url);
      const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      loginUrl.searchParams.set("returnTo", returnTo);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/portal/:path*"],
};
