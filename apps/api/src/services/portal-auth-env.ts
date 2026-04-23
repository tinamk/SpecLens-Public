import crypto from "node:crypto";
import { isTrustedLocalHostname } from "@speclens/core";

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
  return env.API_AUTH_MODE === "local-dev"
    && isTrustedLocalUrl(env.APP_URL ?? null, "http://localhost:3000")
    && isTrustedLocalUrl(env.API_URL ?? null, "http://localhost:4000");
}

function buildLocalDevFallbackSecret(kind: "session" | "csrf", env: NodeJS.ProcessEnv = process.env): string {
  const seed = [
    kind,
    process.cwd(),
    env.APP_URL ?? "",
    env.API_URL ?? "",
  ].join("|");
  return crypto.createHash("sha256").update(`${LOCAL_DEV_PORTAL_SECRET_NAMESPACE}|${seed}`).digest("hex");
}

export function resolvePortalAuthEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const portalSessionSecret = env.PORTAL_SESSION_SECRET?.trim();
  const csrfSecret = env.CSRF_SECRET?.trim();
  if (portalSessionSecret && csrfSecret) {
    return env;
  }
  if (!isSafeLocalDevAuthContext(env)) {
    return env;
  }
  return {
    ...env,
    PORTAL_SESSION_SECRET: portalSessionSecret || csrfSecret || buildLocalDevFallbackSecret("session", env),
    CSRF_SECRET: csrfSecret || portalSessionSecret || buildLocalDevFallbackSecret("csrf", env),
  };
}
