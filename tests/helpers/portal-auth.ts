import { buildPortalCsrfToken, decodePortalSessionToken, encodePortalSessionToken, type PortalSession } from "@speclens/core";

export function ensureTestAuthSecrets(): void {
  process.env.CSRF_SECRET ??= "speclens-test-csrf-secret";
  process.env.APP_STATE_ENCRYPTION_KEY ??= "speclens-test-app-state-secret";
}

export function makePortalSessionCookie(payload: PortalSession): string {
  ensureTestAuthSecrets();
  return `speclens_portal_session=${encodePortalSessionToken(payload)}`;
}

export const localDevCookie = makePortalSessionCookie({
  provider: "local-dev",
  subject: "local-dev-user",
  email: "local-dev@speclens.test",
  displayName: "Local Dev User",
});

export function readPortalSessionValue(cookieHeader: string): string | null {
  return cookieHeader
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith("speclens_portal_session="))
    ?.slice("speclens_portal_session=".length) ?? null;
}

export function readPortalSession(cookieHeader: string): PortalSession | null {
  const sessionValue = readPortalSessionValue(cookieHeader);
  return sessionValue ? decodePortalSessionToken(sessionValue) : null;
}

export function computeCsrfToken(sessionValue: string): string {
  ensureTestAuthSecrets();
  return buildPortalCsrfToken(sessionValue);
}

export async function authenticatedInject(
  app: { inject: (options: Record<string, unknown>) => Promise<unknown> },
  options: Record<string, unknown>,
): Promise<unknown> {
  const existingHeaders = (options.headers as Record<string, string | undefined> | undefined) ?? {};
  const baseCookie = existingHeaders.cookie ?? localDevCookie;
  const sessionValue = readPortalSessionValue(baseCookie) ?? localDevCookie.split("=", 2)[1] ?? "";
  const csrfToken = computeCsrfToken(sessionValue);
  const combinedCookie = baseCookie.includes("speclens_csrf=")
    ? baseCookie
    : `${baseCookie}; speclens_csrf=${csrfToken}`;
  const finalCookie = readPortalSessionValue(combinedCookie) ? combinedCookie : `${combinedCookie}; ${localDevCookie}`;
  return app.inject({
    ...options,
    headers: {
      ...existingHeaders,
      cookie: finalCookie,
      "x-csrf-token": csrfToken,
    },
  });
}

export async function ensureAuthenticatedPortalUser(
  headers?: Record<string, string | undefined>,
) {
  const cookie = headers?.cookie ?? localDevCookie;
  const session = readPortalSession(cookie);
  if (!session) {
    throw new Error("Authenticated test user requires a valid portal session cookie.");
  }
  const { upsertUserIdentity } = await import("@speclens/db");
  return await upsertUserIdentity({
    provider: session.provider,
    subject: session.subject,
    email: session.email,
    displayName: session.displayName,
  });
}
