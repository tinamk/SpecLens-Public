import { NextResponse } from "next/server";
import { idTokenCookieName, sessionCookieName } from "../../../../lib/auth";
import { assertTrustedPortalApiBaseUrl, resolveInternalApiBaseUrl } from "../../../../lib/internal-api";
import { resolvePublicRequestOrigin } from "../../../../lib/request-origin";

function getApiBaseUrl(): string {
  return resolveInternalApiBaseUrl();
}

function getPublicOrigin(request: Request): string {
  return resolvePublicRequestOrigin({
    requestUrl: request.url,
    forwardedProto: request.headers.get("x-forwarded-proto"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedPort: request.headers.get("x-forwarded-port"),
    configuredBaseUrl: process.env.APP_URL?.trim() ?? null,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = getPublicOrigin(request);
  const state = url.searchParams.get("state");
  const installationId = url.searchParams.get("installation_id");
  const setupAction = url.searchParams.get("setup_action");
  if (!state || !installationId) {
    return NextResponse.redirect(new URL("/portal/workspaces?github=missing-callback-data", origin));
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const idToken = cookieHeader
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${idTokenCookieName()}=`))
    ?.slice(`${idTokenCookieName()}=`.length);
  const session = cookieHeader
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${sessionCookieName()}=`))
    ?.slice(`${sessionCookieName()}=`.length);
  const headers = new Headers({
    "content-type": "application/json",
  });
  if (idToken || session) {
    try {
      assertTrustedPortalApiBaseUrl(getApiBaseUrl());
    } catch {
      return NextResponse.redirect(new URL("/portal/workspaces?github=link-failed", origin));
    }
  }
  if (idToken) {
    headers.set("authorization", `Bearer ${idToken}`);
  }
  if (session) {
    headers.set("cookie", `${sessionCookieName()}=${session}`);
  }

  const response = await fetch(`${getApiBaseUrl()}/api/integrations/github/link`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      state,
      installationId,
    }),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null) as { workspaceId?: string } | null;
  const workspaceId = typeof payload?.workspaceId === "string" ? payload.workspaceId : null;
  const target = new URL(workspaceId ? `/portal/workspaces/${workspaceId}/settings` : "/portal/workspaces", origin);
  if (!response.ok) {
    target.searchParams.set("github", "link-failed");
    return NextResponse.redirect(target);
  }

  target.searchParams.set("github", setupAction === "update" ? "updated" : "connected");
  return NextResponse.redirect(target);
}
