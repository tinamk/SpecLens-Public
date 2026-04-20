import crypto from "node:crypto";

export interface PortalSession {
  provider: "local-dev" | "keycloak";
  subject: string;
  email: string;
  displayName: string;
}

function readPortalSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.PORTAL_SESSION_SECRET ?? env.CSRF_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error("PORTAL_SESSION_SECRET or CSRF_SECRET is required for portal session signing.");
  }
  return secret;
}

function readCsrfSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.CSRF_SECRET ?? env.PORTAL_SESSION_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error("CSRF_SECRET or PORTAL_SESSION_SECRET is required for CSRF protection.");
  }
  return secret;
}

function isPortalSessionPayload(value: Partial<PortalSession>): value is PortalSession {
  return (value.provider === "local-dev" || value.provider === "keycloak")
    && typeof value.subject === "string"
    && typeof value.email === "string"
    && typeof value.displayName === "string";
}

export function encodePortalSessionToken(session: PortalSession, env: NodeJS.ProcessEnv = process.env): string {
  const body = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", readPortalSessionSecret(env)).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function decodePortalSessionToken(token: string, env: NodeJS.ProcessEnv = process.env): PortalSession | null {
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length > 0) {
    return null;
  }

  const expected = crypto.createHmac("sha256", readPortalSessionSecret(env)).update(body).digest("base64url");
  const provided = Buffer.from(signature, "utf8");
  const required = Buffer.from(expected, "utf8");
  if (provided.length !== required.length || !crypto.timingSafeEqual(provided, required)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<PortalSession>;
    return isPortalSessionPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function buildPortalCsrfToken(sessionToken: string, env: NodeJS.ProcessEnv = process.env): string {
  return crypto.createHmac("sha256", readCsrfSecret(env)).update(sessionToken).digest("hex");
}
