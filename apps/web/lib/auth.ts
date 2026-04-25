import crypto from "node:crypto";
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
const LOCAL_DEV_PORTAL_SECRET_NAMESPACE = "speclens-local-dev-portal-auth";

function isTrustedLocalUrl(value: string | null | undefined, fallback: string): boolean {
  try {
    const url = new URL(value?.trim() || fallback);
    return isTrustedLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isSafeLocalDevAuthContext(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SPECLENS_ALLOW_UNSAFE_LOCAL_DEV_AUTH === "true") {
    return true;
  }
  return isTrustedLocalUrl(env.APP_URL ?? null, "http://localhost:3000")
    && isTrustedLocalUrl(env.INTERNAL_API_URL ?? env.API_URL ?? null, "http://localhost:4000");
}

export function canUseLocalDevPortalSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.API_AUTH_MODE === "local-dev" && isSafeLocalDevAuthContext(env);
}

function buildLocalDevFallbackSecret(kind: "session" | "csrf", env: NodeJS.ProcessEnv = process.env): string {
  const seed = [
    kind,
    process.cwd(),
    env.APP_URL ?? "",
    env.INTERNAL_API_URL ?? env.API_URL ?? "",
  ].join("|");
  return crypto.createHash("sha256").update(`${LOCAL_DEV_PORTAL_SECRET_NAMESPACE}|${seed}`).digest("hex");
}

function resolvePortalAuthEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const portalSessionSecret = env.PORTAL_SESSION_SECRET?.trim();
  const csrfSecret = env.CSRF_SECRET?.trim();
  if (portalSessionSecret && csrfSecret) {
    return env;
  }
  if (!isSafeLocalDevAuthContext()) {
    return env;
  }
  return {
    ...env,
    PORTAL_SESSION_SECRET: portalSessionSecret || buildLocalDevFallbackSecret("session", env),
    CSRF_SECRET: csrfSecret || buildLocalDevFallbackSecret("csrf", env),
  };
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
  if (!canUseLocalDevPortalSession()) {
    throw new Error(
      "Refusing to mint a local-dev portal session unless API_AUTH_MODE=local-dev and app/API origins are local or private. "
      + "Set API_AUTH_MODE=local-dev for local cookie auth, or configure Keycloak for hosted auth.",
    );
  }
  return encodePortalSessionToken({
    provider: "local-dev",
    subject: "local-dev-user",
    email: "demo@speclens.dev",
    displayName: "Local Dev User",
  }, resolvePortalAuthEnv());
}

export function buildKeycloakSession(idToken: string): string {
  const payload = decodeJwtPayload(idToken) ?? {};
  return encodePortalSessionToken({
    provider: "keycloak",
    subject: String(payload.sub ?? "unknown-user"),
    email: String(payload.email ?? "unknown@speclens.dev"),
    displayName: String(payload.name ?? payload.preferred_username ?? payload.email ?? "Keycloak User"),
  }, resolvePortalAuthEnv());
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
  return buildPortalCsrfToken(sessionValue, resolvePortalAuthEnv());
}

export function decodePortalSessionValue(sessionValue: string): PortalSession | null {
  return decodePortalSessionToken(sessionValue, resolvePortalAuthEnv());
}

export function getKeycloakConfig() {
  const rawIssuer = process.env.KEYCLOAK_ISSUER_URL ?? null;
  // KEYCLOAK_ISSUER_URL may be comma-separated when the app is reachable at
  // multiple public origins (e.g. localhost + tailscale). The web app uses
  // only the first entry to build login/redirect URLs; per-request host
  // rewriting in `resolveConfiguredUrlForRequest` handles the others.
  const issuer = rawIssuer ? rawIssuer.split(",")[0]!.trim() : null;
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

export function resolveConfiguredUrlForRequest(requestUrl: string, configuredUrl: string | null): string | null {
  if (!configuredUrl) {
    return null;
  }

  const configured = new URL(configuredUrl);
  const requestHost = new URL(requestUrl).hostname;
  if (!isLoopbackHost(configured.hostname) || isLoopbackHost(requestHost)) {
    return configured.toString();
  }

  const publicOrigin = new URL(requestUrl).origin;
  return new URL(`${configured.pathname}${configured.search}${configured.hash}`, `${publicOrigin}/`).toString();
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

export function buildPortalReturnTo(
  pathname: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      params.set(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    }
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
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
  const session = decodePortalSessionValue(sessionValue);
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
  return sessionValue ? decodePortalSessionValue(sessionValue) : null;
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
