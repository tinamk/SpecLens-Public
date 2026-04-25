import { NextResponse } from "next/server";
import {
  buildKeycloakSession,
  buildLocalDevSession,
  canUseLocalDevPortalSession,
  buildCsrfToken,
  csrfCookieName,
  exchangeCodeForToken,
  getKeycloakConfig,
  idTokenCookieName,
  resolveAuthBaseUrl,
  resolveSafeReturnTo,
  sessionCookieName,
  stateCookieName,
} from "../../../../lib/auth";
import { resolvePublicRequestOrigin } from "../../../../lib/request-origin";

function appendAuthFailureReason(returnTo: string): string {
  const [path = "/portal/workspaces", query = ""] = returnTo.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("auth", "callback-invalid");
  const nextQuery = params.toString();
  return nextQuery ? `${path}?${nextQuery}` : path;
}

function buildPublicCallbackFailureUrl(appBaseUrl: string, returnTo: string): URL {
  const failureUrl = new URL("/login", appBaseUrl);
  failureUrl.searchParams.set("auth", "callback-invalid");
  failureUrl.searchParams.set("returnTo", appendAuthFailureReason(returnTo));
  return failureUrl;
}

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
  const returnTo = resolveSafeReturnTo(requestedReturnTo, appBaseUrl);

  if (!config.enabled) {
    if (!canUseLocalDevPortalSession()) {
      return NextResponse.redirect(buildPublicCallbackFailureUrl(appBaseUrl, returnTo));
    }
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
    return response;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = request.headers.get("cookie")
    ?.split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${stateCookieName()}=`))
    ?.split("=")[1];

  if (!code || !state || !storedState || storedState !== state) {
    return NextResponse.redirect(buildPublicCallbackFailureUrl(appBaseUrl, returnTo));
  }

  const callbackUrl = new URL("/api/auth/callback", appBaseUrl);
  callbackUrl.searchParams.set("returnTo", returnTo);
  const token = await exchangeCodeForToken(code, callbackUrl.toString());
  const response = NextResponse.redirect(new URL(returnTo, appBaseUrl));
  if (!token.idToken && !canUseLocalDevPortalSession()) {
    return NextResponse.redirect(buildPublicCallbackFailureUrl(appBaseUrl, returnTo));
  }
  const sessionValue = token.idToken ? buildKeycloakSession(token.idToken) : buildLocalDevSession();
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
  if (token.idToken) {
    response.cookies.set(idTokenCookieName(), token.idToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
    });
  } else {
    response.cookies.delete(idTokenCookieName());
  }
  response.cookies.delete(stateCookieName());
  return response;
}
