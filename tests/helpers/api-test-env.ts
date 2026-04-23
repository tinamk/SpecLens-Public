import { disconnectDatabase } from "@speclens/db";
import { ensureTestAuthSecrets } from "./portal-auth";

const defaultApiTestEnv: Record<string, string> = {
  NODE_ENV: "test",
  API_AUTH_MODE: "local-dev",
  APP_URL: "http://localhost:3000",
  API_URL: "http://localhost:4000",
  CORS_ALLOWED_ORIGINS: "",
  ADMIN_EMAILS: "",
  KEYCLOAK_ISSUER_URL: "",
  KEYCLOAK_INTERNAL_ISSUER_URL: "",
  KEYCLOAK_CLIENT_ID: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  STRIPE_PRICE_PRO_MONTHLY_USD: "",
  STRIPE_SUCCESS_URL: "",
  STRIPE_CANCEL_URL: "",
  GITHUB_APP_WEBHOOK_SECRET: "",
  GITHUB_APP_PRIVATE_KEY: "",
  GITHUB_APP_PRIVATE_KEY_FILE: "",
  GITHUB_APP_ID: "",
  GITHUB_GATEWAY_URL: "",
  GITHUB_GATEWAY_DOMAIN: "",
  GITHUB_GATEWAY_REGISTRATION_TOKEN: "speclens-test-github-gateway-secret",
  GITHUB_ALLOWED_RETURN_ORIGINS: "",
  GITHUB_API_TOKEN: "",
  SPECLENS_PREFER_AGENT_ENGINE: "false",
  SPECLENS_ALLOW_UNSAFE_LOCAL_DEV_AUTH: "",
  OBJECT_STORAGE_PROVIDER: "local",
  OBJECT_STORAGE_BUCKET: "",
  OBJECT_STORAGE_ENDPOINT: "",
  OBJECT_STORAGE_PUBLIC_ENDPOINT: "",
  OBJECT_STORAGE_REGION: "",
  OBJECT_STORAGE_FORCE_PATH_STYLE: "",
  OBJECT_STORAGE_ACCESS_KEY_ID: "",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "",
  OBJECT_STORAGE_MIRROR_PROVIDER: "",
  OBJECT_STORAGE_MIRROR_BUCKET: "",
  OBJECT_STORAGE_MIRROR_ENDPOINT: "",
  OBJECT_STORAGE_MIRROR_PUBLIC_ENDPOINT: "",
  OBJECT_STORAGE_MIRROR_REGION: "",
  OBJECT_STORAGE_MIRROR_FORCE_PATH_STYLE: "",
  OBJECT_STORAGE_MIRROR_ACCESS_KEY_ID: "",
  OBJECT_STORAGE_MIRROR_SECRET_ACCESS_KEY: "",
  OBJECT_STORAGE_MIRROR_REQUIRED: "",
  METRICS_ENABLED: "false",
  RATE_LIMIT_ENABLED: "",
  RATE_LIMIT_MAX: "",
  RATE_LIMIT_WINDOW_MS: "",
  RATE_LIMIT_ALLOW_LIST: "",
};

function setEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

export async function installApiTestEnv(overrides: Record<string, string> = {}): Promise<() => Promise<void>> {
  const nextEnv = {
    ...defaultApiTestEnv,
    ...overrides,
  };
  const touchedKeys = new Set([
    ...Object.keys(defaultApiTestEnv),
    ...Object.keys(overrides),
  ]);
  const previousEnv = new Map<string, string | undefined>();
  for (const key of touchedKeys) {
    previousEnv.set(key, process.env[key]);
  }

  await disconnectDatabase();
  for (const [key, value] of Object.entries(nextEnv)) {
    setEnvValue(key, value);
  }
  ensureTestAuthSecrets();

  return async () => {
    await disconnectDatabase();
    for (const [key, value] of previousEnv) {
      setEnvValue(key, value);
    }
  };
}
