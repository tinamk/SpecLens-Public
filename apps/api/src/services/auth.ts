import { createRemoteJWKSet, jwtVerify } from "jose";
import type { User } from "@speclens/contracts";
import { decodePortalSessionToken } from "@speclens/core";
import { statusError, upsertUserIdentity as upsertDbUserIdentity } from "@speclens/db";
import { loadApiConfig } from "./config";
import { resolvePortalAuthEnv } from "./portal-auth-env";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function readBearerToken(value: string | string[] | undefined): string | null {
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function getRemoteJwkSet(issuerUrl: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = jwksCache.get(issuerUrl);
  if (existing) {
    return existing;
  }
  const next = createRemoteJWKSet(new URL(`${issuerUrl}/protocol/openid-connect/certs`));
  jwksCache.set(issuerUrl, next);
  return next;
}

function decodePortalSession(cookieHeader: string | null | undefined): {
  provider: string;
  subject: string;
  email: string;
  displayName: string;
} | null {
  const token = cookieHeader
    ?.split(";")
    .map(part => part.trim())
    .find(part => part.startsWith("speclens_portal_session="))
    ?.slice("speclens_portal_session=".length);

  if (!token) {
    return null;
  }
  return decodePortalSessionToken(token, resolvePortalAuthEnv());
}

async function verifyKeycloakToken(token: string): Promise<{
  sub: string;
  email: string;
  displayName: string;
}> {
  const config = loadApiConfig();
  if (!config.keycloakIssuerUrl || !config.keycloakInternalIssuerUrl) {
    throw new Error("Keycloak is not configured for bearer-token validation.");
  }

  const jwks = getRemoteJwkSet(config.keycloakInternalIssuerUrl);
  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: config.keycloakIssuerUrl,
      ...(config.keycloakClientId ? { audience: config.keycloakClientId } : {}),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid bearer token.";
    throw statusError(401, message);
  }

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) {
    throw new Error("Keycloak token is missing a subject.");
  }

  const email = typeof payload.email === "string" && payload.email.length > 0
    ? payload.email
    : `${sub}@speclens.invalid`;
  const displayName = typeof payload.name === "string" && payload.name.length > 0
    ? payload.name
    : typeof payload.preferred_username === "string" && payload.preferred_username.length > 0
      ? payload.preferred_username
      : email;

  return {
    sub,
    email,
    displayName,
  };
}

export async function resolveAuthenticatedUser(headers: {
  authorization?: string | string[] | undefined;
  cookie?: string | null | undefined;
}): Promise<User> {
  const config = loadApiConfig();
  const bearer = readBearerToken(headers.authorization);
  if (bearer) {
    const verified = await verifyKeycloakToken(bearer);
    return upsertDbUserIdentity({
      provider: "keycloak",
      subject: verified.sub,
      email: verified.email,
      displayName: verified.displayName,
    });
  }

  if (config.authMode === "local-dev") {
    const session = decodePortalSession(headers.cookie);
    if (!session) {
      throw statusError(401, "Authentication is required.");
    }
    return upsertDbUserIdentity({
      provider: session.provider,
      subject: session.subject,
      email: session.email,
      displayName: session.displayName,
    });
  }

  throw statusError(401, "Authentication is required.");
}

export function assertAdminUser(user: User): User {
  const config = loadApiConfig();
  const normalizedEmail = user.email.trim().toLowerCase();
  if (config.adminEmails.includes(normalizedEmail)) {
    return user;
  }
  throw statusError(403, "Administrator access is required.");
}
