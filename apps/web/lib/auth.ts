import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const SESSION_COOKIE = "speclens_portal_session";
const STATE_COOKIE = "speclens_oidc_state";
const ID_TOKEN_COOKIE = "speclens_portal_id_token";

export interface PortalSession {
  provider: "local-dev" | "keycloak";
  subject: string;
  email: string;
  displayName: string;
}

function encodeSession(session: PortalSession): string {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
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
  return encodeSession({
    provider: "local-dev",
    subject: "local-dev-user",
    email: "demo@speclens.dev",
    displayName: "Local Dev User",
  });
}

export function buildKeycloakSession(idToken: string): string {
  const payload = decodeJwtPayload(idToken) ?? {};
  return encodeSession({
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

export function getKeycloakConfig() {
  const issuer = process.env.KEYCLOAK_ISSUER_URL ?? null;
  const internalIssuer = process.env.KEYCLOAK_INTERNAL_ISSUER_URL ?? issuer;
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? null;
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET ?? null;
  const baseUrl = process.env.KEYCLOAK_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000";

  return {
    issuer,
    internalIssuer,
    clientId,
    clientSecret,
    baseUrl,
    enabled: Boolean(issuer && clientId),
  };
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

export async function requirePortalSession(returnTo: string): Promise<void> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  if (session) {
    return;
  }
  redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}
