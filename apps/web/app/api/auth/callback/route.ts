import { NextResponse } from "next/server";
import {
  buildKeycloakSession,
  buildLocalDevSession,
  exchangeCodeForToken,
  getKeycloakConfig,
  idTokenCookieName,
  sessionCookieName,
  stateCookieName,
} from "../../../../lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo") ?? "/portal";
  const config = getKeycloakConfig();

  if (!config.enabled) {
    const response = NextResponse.redirect(new URL(returnTo, url.origin));
    response.cookies.set(sessionCookieName(), buildLocalDevSession(), {
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
    return NextResponse.redirect(new URL(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`, url.origin));
  }

  const callbackUrl = new URL("/api/auth/callback", url.origin);
  callbackUrl.searchParams.set("returnTo", returnTo);
  const token = await exchangeCodeForToken(code, callbackUrl.toString());
  const response = NextResponse.redirect(new URL(returnTo, url.origin));
  response.cookies.set(sessionCookieName(), token.idToken ? buildKeycloakSession(token.idToken) : buildLocalDevSession(), {
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
