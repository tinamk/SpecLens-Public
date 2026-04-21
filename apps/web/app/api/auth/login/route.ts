import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { buildCsrfToken, buildLocalDevSession, csrfCookieName, getKeycloakConfig, idTokenCookieName, resolveAuthBaseUrl, resolveConfiguredUrlForRequest, resolveSafeReturnTo, sessionCookieName, stateCookieName } from "../../../../lib/auth";
import { resolvePublicRequestOrigin } from "../../../../lib/request-origin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedReturnTo = url.searchParams.get("returnTo");
  const config = getKeycloakConfig();
  let forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedPort = request.headers.get("x-forwarded-port");
  if (forwardedHost && forwardedPort && !forwardedHost.includes(":")) {
    forwardedHost = `${forwardedHost}:${forwardedPort}`;
  }
  const requestUrl = resolvePublicRequestOrigin({
    requestUrl: request.url,
    forwardedProto,
    forwardedHost,
    forwardedPort,
    configuredBaseUrl: process.env.APP_URL ?? null,
  }) + `${url.pathname}${url.search}`;
  const appBaseUrl = resolveAuthBaseUrl(requestUrl, config.baseUrl);
  const issuer = resolveConfiguredUrlForRequest(requestUrl, config.issuer);
  const returnTo = resolveSafeReturnTo(requestedReturnTo, appBaseUrl);

  if (!config.enabled || !issuer || !config.clientId) {
    const response = NextResponse.redirect(new URL(returnTo, appBaseUrl));
    const sessionValue = buildLocalDevSession();
    response.cookies.set(sessionCookieName(), sessionValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
    });
    response.cookies.set(csrfCookieName(), buildCsrfToken(sessionValue), {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
    });
    response.cookies.delete(idTokenCookieName());
    return response;
  }

  const state = crypto.randomUUID();
  const callbackUrl = new URL("/api/auth/callback", appBaseUrl);
  callbackUrl.searchParams.set("returnTo", returnTo);
  const authUrl = new URL(`${issuer}/protocol/openid-connect/auth`);
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
