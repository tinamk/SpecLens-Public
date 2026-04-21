import { NextResponse } from "next/server";
import { csrfCookieName, getKeycloakConfig, idTokenCookieName, resolveAuthBaseUrl, resolveConfiguredUrlForRequest, sessionCookieName, stateCookieName } from "../../../../lib/auth";
import { resolvePublicRequestOrigin } from "../../../../lib/request-origin";

export async function GET(request: Request) {
  const url = new URL(request.url);
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
  const redirectTarget = new URL("/pricing", appBaseUrl);
  const idToken = (request.headers.get("cookie") ?? "")
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${idTokenCookieName()}=`))
    ?.slice(`${idTokenCookieName()}=`.length);
  const keycloakCookiePath = issuer
    ? `${new URL(issuer).pathname.replace(/\/+$/, "")}/`
    : "/auth/";
  const secureLogoutCookies = redirectTarget.protocol === "https:"
    || redirectTarget.hostname === "localhost"
    || redirectTarget.hostname === "127.0.0.1";
  const logoutTarget = issuer
    ? new URL(`${issuer}/protocol/openid-connect/logout`)
    : redirectTarget;

  if (issuer) {
    logoutTarget.searchParams.set("post_logout_redirect_uri", redirectTarget.toString());
    if (config.clientId) {
      logoutTarget.searchParams.set("client_id", config.clientId);
    }
    if (idToken) {
      logoutTarget.searchParams.set("id_token_hint", idToken);
    }
  }

  const response = NextResponse.redirect(logoutTarget);
  response.cookies.delete(sessionCookieName());
  response.cookies.delete(stateCookieName());
  response.cookies.delete(idTokenCookieName());
  response.cookies.delete(csrfCookieName());
  for (const cookieName of [
    "AUTH_SESSION_ID",
    "AUTH_SESSION_ID_LEGACY",
    "KEYCLOAK_IDENTITY",
    "KEYCLOAK_IDENTITY_LEGACY",
    "KEYCLOAK_SESSION",
    "KEYCLOAK_SESSION_LEGACY",
    "KC_AUTH_SESSION_HASH",
    "KC_RESTART",
  ]) {
    response.cookies.set(cookieName, "", {
      path: keycloakCookiePath,
      expires: new Date(0),
      maxAge: 0,
      httpOnly: cookieName !== "KC_AUTH_SESSION_HASH" && cookieName !== "KEYCLOAK_SESSION",
      secure: secureLogoutCookies,
      sameSite: "none",
    });
  }
  return response;
}
