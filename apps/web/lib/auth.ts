import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  buildPortalCsrfToken,
  decodePortalSessionToken,
  encodePortalSessionToken,
  isTrustedLocalHostname,
  type PortalSession,
} from "@speclens/core";

const SESSION_COOKIE = "speclens_portal_session";
const STATE_COOKIE = "speclens_oidc_state";
const ID_TOKEN_COOKIE = "speclens_portal_id_token";
const CSRF_COOKIE = "speclens_csrf";

function isTrustedLocalUrl(value: string | null | undefined, fallback: string): boolean {
  try {
    const url = new URL(value?.trim() || fallback);
    return isTrustedLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isSafeLocalDevAuthContext(): boolean {
  if (process.env.SPECLENS_ALLOW_UNSAFE_LOCAL_DEV_AUTH === "true") {
    return true;
  }
  return isTrustedLocalUrl(process.env.APP_URL ?? null, "http://localhost:3000")
    && isTrustedLocalUrl(process.env.INTERNAL_API_URL ?? process.env.API_URL ?? null, "http://localhost:4000");
}

function resolveAdminEmails(): string[] {
  if (process.env.ADMIN_EMAILS) {
    return process.env.ADMIN_EMAILS.split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function buildLocalDevSession(): string {
  if (!isSafeLocalDevAuthContext()) {
    throw new Error(
      "Refusing to mint a local-dev portal session outside a local/private app+API context. "
      + "Set SPECLENS_ALLOW_UNSAFE_LOCAL_DEV_AUTH=true to override intentionally.",
    );
  }
  return encodePortalSessionToken({
    provider: "local-dev",
    subject: "local-dev-user",
    email: "demo@speclens.dev",
    displayName: "Local Dev User",
  });
}

export function buildKeycloakSession(idToken: string): string {
  const payload = decodeJwtPayload(idToken) ?? {};
  return encodePortalSessionToken({
    provider: "keycloak",
    subject: String(payload.sub ?? "unknown-user"),
    email: String(payload.email ?? "unknown@speclens.dev"),
    displayName: String(payload.name ?? payload.preferred_username ?? payload.email ?? "Keycloak User"),
  });
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

export function stateCookieName(): string {
  return STATE_COOKIE;
}

export function idTokenCookieName(): string {
  return ID_TOKEN_COOKIE;
}

export function csrfCookieName(): string {
  return CSRF_COOKIE;
}

export function buildCsrfToken(sessionValue: string): string {
  return buildPortalCsrfToken(sessionValue);
}

export function getKeycloakConfig() {
  const issuer = process.env.KEYCLOAK_ISSUER_URL ?? null;
  const internalIssuer = process.env.KEYCLOAK_INTERNAL_ISSUER_URL ?? issuer;
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? null;
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET ?? null;
  const baseUrl = process.env.KEYCLOAK_BASE_URL ?? process.env.APP_URL ?? null;

  return {
    issuer,
    internalIssuer,
    clientId,
    clientSecret,
    baseUrl,
    enabled: Boolean(issuer && clientId),
  };
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "0.0.0.0";
}

export function resolveAuthBaseUrl(requestUrl: string, configuredBaseUrl: string | null): string {
  const requestOrigin = new URL(requestUrl).origin;
  if (!configuredBaseUrl) {
    return requestOrigin;
  }

  const configuredOrigin = new URL(configuredBaseUrl).origin;
  const requestHost = new URL(requestOrigin).hostname;
  const configuredHost = new URL(configuredOrigin).hostname;

  if (configuredOrigin === requestOrigin) {
    return configuredOrigin;
  }

  if (!isLoopbackHost(requestHost)) {
    return requestOrigin;
  }

  if (isLoopbackHost(configuredHost)) {
    return requestOrigin;
  }

  if (isLoopbackHost(requestHost) && !isLoopbackHost(configuredHost)) {
    return requestOrigin;
  }

  return configuredOrigin;
}

export function resolveSafeReturnTo(returnTo: string | null | undefined, appBaseUrl: string, fallback: string = "/portal/workspaces"): string {
  const candidate = returnTo?.trim();
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  try {
    const target = new URL(candidate, appBaseUrl);
    const appOrigin = new URL(appBaseUrl).origin;
    if (target.origin !== appOrigin) {
      return fallback;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<{ idToken: string | null }> {
  const config = getKeycloakConfig();
  if (!config.internalIssuer || !config.clientId) {
    return { idToken: null };
  }

  const endpoint = `${config.internalIssuer}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
  });
  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Keycloak token exchange failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as { id_token?: string };
  return {
    idToken: payload.id_token ?? null,
  };
}

export async function requirePortalSession(returnTo: string): Promise<PortalSession> {
  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionValue) {
    redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  const session = decodePortalSessionToken(sessionValue);
  if (!session) {
    redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (session.provider === "keycloak") {
    const idToken = cookieStore.get(ID_TOKEN_COOKIE)?.value;
    const payload = idToken ? decodeJwtPayload(idToken) : null;
    const exp = typeof payload?.exp === "number" ? payload.exp : null;
    if (!idToken || !exp || (exp * 1000) <= (Date.now() + 5_000)) {
      redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
  }
  return session;
}

export async function readPortalSession(): Promise<PortalSession | null> {
  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(SESSION_COOKIE)?.value;
  return sessionValue ? decodePortalSessionToken(sessionValue) : null;
}

export function isPortalAdminSession(session: PortalSession): boolean {
  return resolveAdminEmails().includes(session.email.trim().toLowerCase());
}

export async function requireAdminSession(returnTo: string): Promise<PortalSession> {
  const session = await requirePortalSession(returnTo);
  if (!isPortalAdminSession(session)) {
    redirect("/portal/workspaces?admin=denied");
  }
  return session;
}
