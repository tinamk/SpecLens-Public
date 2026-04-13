import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { buildLocalDevSession, getKeycloakConfig, idTokenCookieName, sessionCookieName, stateCookieName } from "../../../../lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo") ?? "/portal";
  const config = getKeycloakConfig();

  if (!config.enabled || !config.issuer || !config.clientId) {
    const response = NextResponse.redirect(new URL(returnTo, url.origin));
    response.cookies.set(sessionCookieName(), buildLocalDevSession(), {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
    });
    response.cookies.delete(idTokenCookieName());
    return response;
  }

  const state = crypto.randomUUID();
  const callbackUrl = new URL("/api/auth/callback", url.origin);
  callbackUrl.searchParams.set("returnTo", returnTo);
  const authUrl = new URL(`${config.issuer}/protocol/openid-connect/auth`);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email");
  authUrl.searchParams.set("redirect_uri", callbackUrl.toString());
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(stateCookieName(), state, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
  });
  return response;
}
