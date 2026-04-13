export interface ApiConfig {
  port: number;
  appUrl: string;
  apiUrl: string;
  keycloakIssuerUrl: string | null;
  keycloakInternalIssuerUrl: string | null;
  keycloakClientId: string | null;
  stripePriceId: string | null;
  objectStorageProvider: "local" | "s3-compatible" | "digitalocean-spaces";
  objectStorageBucket: string | null;
  objectStorageEndpoint: string | null;
  objectStoragePublicEndpoint: string | null;
  objectStorageRegion: string | null;
  objectStorageForcePathStyle: boolean;
}

function readStorageProvider(): ApiConfig["objectStorageProvider"] {
  const raw = process.env.OBJECT_STORAGE_PROVIDER ?? "local";
  if (raw === "s3-compatible" || raw === "digitalocean-spaces") {
    return raw;
  }
  return "local";
}

export function loadApiConfig(): ApiConfig {
  return {
    port: Number(process.env.PORT ?? 4000),
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    apiUrl: process.env.API_URL ?? "http://localhost:4000",
    keycloakIssuerUrl: process.env.KEYCLOAK_ISSUER_URL ?? null,
    keycloakInternalIssuerUrl: process.env.KEYCLOAK_INTERNAL_ISSUER_URL ?? process.env.KEYCLOAK_ISSUER_URL ?? null,
    keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? null,
    stripePriceId: process.env.STRIPE_PRICE_PRO_MONTHLY_USD ?? null,
    objectStorageProvider: readStorageProvider(),
    objectStorageBucket: process.env.OBJECT_STORAGE_BUCKET ?? process.env.SPACES_BUCKET ?? null,
    objectStorageEndpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? process.env.SPACES_ENDPOINT ?? null,
    objectStoragePublicEndpoint: process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? process.env.OBJECT_STORAGE_ENDPOINT ?? process.env.SPACES_ENDPOINT ?? null,
    objectStorageRegion: process.env.OBJECT_STORAGE_REGION ?? process.env.SPACES_REGION ?? null,
    objectStorageForcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
  };
}
