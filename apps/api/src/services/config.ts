import { isTrustedLocalHostname } from "@speclens/core";

export interface ApiConfig {
  port: number;
  appUrl: string;
  apiUrl: string;
  corsAllowedOrigins: string[];
  authMode: "keycloak" | "local-dev";
  trustProxy: boolean;
  adminEmails: string[];
  keycloakIssuerUrl: string | null;
  keycloakInternalIssuerUrl: string | null;
  keycloakClientId: string | null;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripePriceId: string | null;
  githubAppName: string | null;
  githubAppSlug: string | null;
  githubAppInstallUrl: string | null;
  githubGatewayUrl: string | null;
  githubGatewayDomain: string | null;
  githubGatewayRegistrationToken: string | null;
  githubAllowedReturnOrigins: string[];
  githubApiToken: string | null;
  objectStorageProvider: "local" | "s3-compatible" | "digitalocean-spaces";
  objectStorageBucket: string | null;
  objectStorageEndpoint: string | null;
  objectStoragePublicEndpoint: string | null;
  objectStorageRegion: string | null;
  objectStorageForcePathStyle: boolean;
  objectStorageAccessKeyId: string | null;
  objectStorageSecretAccessKey: string | null;
  objectStorageMirror: {
    objectStorageProvider: "local" | "s3-compatible" | "digitalocean-spaces";
    objectStorageBucket: string | null;
    objectStorageEndpoint: string | null;
    objectStoragePublicEndpoint: string | null;
    objectStorageRegion: string | null;
    objectStorageForcePathStyle: boolean;
    objectStorageAccessKeyId: string | null;
    objectStorageSecretAccessKey: string | null;
  } | null;
  objectStorageMirrorRequired: boolean;
  auditLogEnabled: boolean;
  csrfSecret: string | null;
  workspaceRetentionDays: number | null;
  rateLimitEnabled: boolean;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  rateLimitAllowList: string[];
  uploadArchiveMaxBytes: number;
  metricsEnabled: boolean;
  httpAccessLogEnabled: boolean;
}

function readStorageProvider(raw: string | undefined, fallback: ApiConfig["objectStorageProvider"] = "local"): ApiConfig["objectStorageProvider"] {
  if (raw === "s3-compatible" || raw === "digitalocean-spaces") {
    return raw;
  }
  return fallback;
}

function isTrustedRuntimeUrl(value: string | undefined, fallback: string): boolean {
  try {
    const url = new URL(value?.trim() || fallback);
    return isTrustedLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function assertSafeLocalDevAuthMode(authMode: ApiConfig["authMode"], appUrl: string, apiUrl: string): void {
  if (authMode !== "local-dev" || process.env.SPECLENS_ALLOW_UNSAFE_LOCAL_DEV_AUTH === "true") {
    return;
  }
  if (isTrustedRuntimeUrl(appUrl, "http://localhost:3000") && isTrustedRuntimeUrl(apiUrl, "http://localhost:4000")) {
    return;
  }
  throw new Error(
    "API_AUTH_MODE=local-dev is only allowed for local/private APP_URL and API_URL. "
    + "Set SPECLENS_ALLOW_UNSAFE_LOCAL_DEV_AUTH=true to override intentionally.",
  );
}

function readMirrorRequired(rawValue: string | undefined, mirrorConfigured: boolean): boolean {
  if (!mirrorConfigured) {
    return false;
  }
  if (rawValue === "false") {
    return false;
  }
  return true;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadApiConfig(): ApiConfig {
  const authMode = process.env.API_AUTH_MODE === "local-dev" ? "local-dev" : "keycloak";
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const apiUrl = process.env.API_URL ?? "http://localhost:4000";
  assertSafeLocalDevAuthMode(authMode, appUrl, apiUrl);
  const objectStorageMirror = process.env.OBJECT_STORAGE_MIRROR_PROVIDER
    ? {
        objectStorageProvider: readStorageProvider(process.env.OBJECT_STORAGE_MIRROR_PROVIDER, "local"),
        objectStorageBucket: process.env.OBJECT_STORAGE_MIRROR_BUCKET ?? null,
        objectStorageEndpoint: process.env.OBJECT_STORAGE_MIRROR_ENDPOINT ?? null,
        objectStoragePublicEndpoint: process.env.OBJECT_STORAGE_MIRROR_PUBLIC_ENDPOINT ?? process.env.OBJECT_STORAGE_MIRROR_ENDPOINT ?? null,
        objectStorageRegion: process.env.OBJECT_STORAGE_MIRROR_REGION ?? null,
        objectStorageForcePathStyle: process.env.OBJECT_STORAGE_MIRROR_FORCE_PATH_STYLE === "true",
        objectStorageAccessKeyId: process.env.OBJECT_STORAGE_MIRROR_ACCESS_KEY_ID ?? null,
        objectStorageSecretAccessKey: process.env.OBJECT_STORAGE_MIRROR_SECRET_ACCESS_KEY ?? null,
      }
    : null;
  return {
    port: Number(process.env.PORT ?? 4000),
    appUrl,
    apiUrl,
    corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS
      ? process.env.CORS_ALLOWED_ORIGINS.split(",").map(value => value.trim()).filter(Boolean)
      : [],
    authMode,
    trustProxy: process.env.API_TRUST_PROXY === "true",
    adminEmails: process.env.ADMIN_EMAILS
      ? process.env.ADMIN_EMAILS.split(",").map(value => value.trim().toLowerCase()).filter(Boolean)
      : [],
    keycloakIssuerUrl: process.env.KEYCLOAK_ISSUER_URL ?? null,
    keycloakInternalIssuerUrl: process.env.KEYCLOAK_INTERNAL_ISSUER_URL ?? process.env.KEYCLOAK_ISSUER_URL ?? null,
    keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? null,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? null,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
    stripePriceId: process.env.STRIPE_PRICE_PRO_MONTHLY_USD ?? null,
    githubAppName: process.env.GITHUB_APP_NAME ?? null,
    githubAppSlug: process.env.GITHUB_APP_SLUG ?? null,
    githubAppInstallUrl: process.env.GITHUB_APP_INSTALL_URL ?? null,
    githubGatewayUrl: process.env.GITHUB_GATEWAY_URL ?? null,
    githubGatewayDomain: process.env.GITHUB_GATEWAY_DOMAIN ?? null,
    githubGatewayRegistrationToken: process.env.GITHUB_GATEWAY_REGISTRATION_TOKEN ?? null,
    githubAllowedReturnOrigins: process.env.GITHUB_ALLOWED_RETURN_ORIGINS
      ? process.env.GITHUB_ALLOWED_RETURN_ORIGINS.split(",").map(value => value.trim()).filter(Boolean)
      : [],
    githubApiToken: process.env.GITHUB_API_TOKEN ?? null,
    objectStorageProvider: readStorageProvider(process.env.OBJECT_STORAGE_PROVIDER, "local"),
    objectStorageBucket: process.env.OBJECT_STORAGE_BUCKET ?? process.env.SPACES_BUCKET ?? null,
    objectStorageEndpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? process.env.SPACES_ENDPOINT ?? null,
    objectStoragePublicEndpoint: process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? process.env.OBJECT_STORAGE_ENDPOINT ?? process.env.SPACES_ENDPOINT ?? null,
    objectStorageRegion: process.env.OBJECT_STORAGE_REGION ?? process.env.SPACES_REGION ?? null,
    objectStorageForcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
    objectStorageAccessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? process.env.SPACES_ACCESS_KEY_ID ?? null,
    objectStorageSecretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? process.env.SPACES_SECRET_ACCESS_KEY ?? null,
    objectStorageMirror,
    objectStorageMirrorRequired: readMirrorRequired(process.env.OBJECT_STORAGE_MIRROR_REQUIRED, objectStorageMirror !== null),
    auditLogEnabled: process.env.AUDIT_LOG_ENABLED === "true",
    csrfSecret: process.env.CSRF_SECRET ?? null,
    workspaceRetentionDays: Number.isFinite(Number(process.env.WORKSPACE_RETENTION_DAYS ?? ""))
      ? Number(process.env.WORKSPACE_RETENTION_DAYS)
      : null,
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED === "true",
    rateLimitMax: Number.isFinite(Number(process.env.RATE_LIMIT_MAX ?? ""))
      ? Number(process.env.RATE_LIMIT_MAX)
      : 120,
    rateLimitWindowMs: Number.isFinite(Number(process.env.RATE_LIMIT_WINDOW_MS ?? ""))
      ? Number(process.env.RATE_LIMIT_WINDOW_MS)
      : 60_000,
    rateLimitAllowList: process.env.RATE_LIMIT_ALLOW_LIST
      ? process.env.RATE_LIMIT_ALLOW_LIST.split(",").map(value => value.trim()).filter(Boolean)
      : [],
    uploadArchiveMaxBytes: readPositiveInteger(process.env.UPLOAD_ARCHIVE_MAX_BYTES, 128 * 1024 * 1024),
    metricsEnabled: process.env.METRICS_ENABLED !== "false",
    httpAccessLogEnabled: process.env.HTTP_ACCESS_LOG_ENABLED === "true" || process.env.NODE_ENV !== "test",
  };
}
