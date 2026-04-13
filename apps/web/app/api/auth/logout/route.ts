import { NextResponse } from "next/server";
import { getKeycloakConfig, idTokenCookieName, sessionCookieName, stateCookieName } from "../../../../lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = getKeycloakConfig();
  const redirectTarget = config.enabled && config.issuer
    ? new URL(`${config.issuer}/protocol/openid-connect/logout`)
    : new URL("/", url.origin);
  if (config.enabled) {
    redirectTarget.searchParams.set("post_logout_redirect_uri", new URL("/", url.origin).toString());
  }

  const response = NextResponse.redirect(redirectTarget);
  response.cookies.delete(sessionCookieName());
  response.cookies.delete(stateCookieName());
  response.cookies.delete(idTokenCookieName());
  return response;
}
