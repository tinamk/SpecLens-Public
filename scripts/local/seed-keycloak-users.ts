import "dotenv/config";
import { localTestUsers } from "./test-users";

type KeycloakUser = {
  id: string;
  username: string;
  email?: string;
};

type KeycloakClient = {
  id: string;
  clientId: string;
  redirectUris?: string[];
  webOrigins?: string[];
  attributes?: Record<string, string>;
};

type SeedUser = {
  username: string;
  email: string;
  displayName: string;
  password: string;
  subject?: string;
};

function trimEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function resolveOptionalEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function deriveAdminBaseUrl(): string {
  const explicit = process.env.KEYCLOAK_ADMIN_URL;
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim().replace(/\/+$/, "");
  }
  const issuer = trimEnv("KEYCLOAK_ISSUER_URL", "http://localhost:8081/realms/speclens");
  const url = new URL(issuer);
  url.pathname = url.pathname.replace(/\/realms\/[^/]+\/?$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function realmName(): string {
  const explicit = process.env.KEYCLOAK_REALM;
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }
  const issuer = trimEnv("KEYCLOAK_ISSUER_URL", "http://localhost:8081/realms/speclens");
  const match = issuer.match(/\/realms\/([^/]+)/);
  return match?.[1] ?? "speclens";
}

function resolveSeedMode(): "local" | "production" {
  if (process.env.E2E_ENV === "production") {
    return "production";
  }
  if (process.env.E2E_ENV === "local") {
    return "local";
  }
  const candidate = [
    process.env.PLAYWRIGHT_BASE_URL,
    process.env.E2E_BASE_URL,
    process.env.APP_URL,
    process.env.KEYCLOAK_BASE_URL,
    process.env.KEYCLOAK_ISSUER_URL,
  ].find(value => value && value.trim().length > 0);
  if (!candidate) {
    return "local";
  }
  return /localhost|127\.0\.0\.1/.test(candidate) ? "local" : "production";
}

function resolveScopedE2eEnv(mode: "local" | "production", label: "OWNER" | "MEMBER" | "OUTSIDER" | "ADMIN", suffix: "USERNAME" | "EMAIL" | "PASSWORD" | "DISPLAY_NAME" | "SUBJECT"): string | null {
  const localKey = `E2E_LOCAL_${label}_${suffix}`;
  const sharedKey = `E2E_${label}_${suffix}`;
  if (mode === "local") {
    return resolveOptionalEnv(localKey);
  }
  return resolveOptionalEnv(sharedKey) ?? resolveOptionalEnv(localKey);
}

function resolveSeedUsers(): SeedUser[] {
  const mode = resolveSeedMode();
  const ownerUsername = resolveScopedE2eEnv(mode, "OWNER", "USERNAME");
  const memberUsername = resolveScopedE2eEnv(mode, "MEMBER", "USERNAME");
  const outsiderUsername = resolveScopedE2eEnv(mode, "OUTSIDER", "USERNAME");
  const adminUsername = resolveScopedE2eEnv(mode, "ADMIN", "USERNAME");
  const ownerPassword = resolveScopedE2eEnv(mode, "OWNER", "PASSWORD");
  const memberPassword = resolveScopedE2eEnv(mode, "MEMBER", "PASSWORD");
  const outsiderPassword = resolveScopedE2eEnv(mode, "OUTSIDER", "PASSWORD");
  const adminPassword = resolveScopedE2eEnv(mode, "ADMIN", "PASSWORD");

  if (
    ownerUsername
    && memberUsername
    && outsiderUsername
    && adminUsername
    && ownerPassword
    && memberPassword
    && outsiderPassword
    && adminPassword
  ) {
    const resolveEmail = (username: string, fallback: string | null): string =>
      (fallback && fallback.includes("@")) ? fallback : username.includes("@") ? username : `${username}@speclens.dev`;

    return [
      {
        username: ownerUsername,
        email: resolveEmail(ownerUsername, resolveScopedE2eEnv(mode, "OWNER", "EMAIL")),
        displayName: resolveScopedE2eEnv(mode, "OWNER", "DISPLAY_NAME") ?? "Owner User",
        password: ownerPassword,
        subject: resolveScopedE2eEnv(mode, "OWNER", "SUBJECT") ?? undefined,
      },
      {
        username: memberUsername,
        email: resolveEmail(memberUsername, resolveScopedE2eEnv(mode, "MEMBER", "EMAIL")),
        displayName: resolveScopedE2eEnv(mode, "MEMBER", "DISPLAY_NAME") ?? "Member User",
        password: memberPassword,
        subject: resolveScopedE2eEnv(mode, "MEMBER", "SUBJECT") ?? undefined,
      },
      {
        username: outsiderUsername,
        email: resolveEmail(outsiderUsername, resolveScopedE2eEnv(mode, "OUTSIDER", "EMAIL")),
        displayName: resolveScopedE2eEnv(mode, "OUTSIDER", "DISPLAY_NAME") ?? "Outsider User",
        password: outsiderPassword,
        subject: resolveScopedE2eEnv(mode, "OUTSIDER", "SUBJECT") ?? undefined,
      },
      {
        username: adminUsername,
        email: resolveEmail(adminUsername, resolveScopedE2eEnv(mode, "ADMIN", "EMAIL")),
        displayName: resolveScopedE2eEnv(mode, "ADMIN", "DISPLAY_NAME") ?? "Admin User",
        password: adminPassword,
        subject: resolveScopedE2eEnv(mode, "ADMIN", "SUBJECT") ?? undefined,
      },
    ];
  }

  return localTestUsers.map(user => ({
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    password: user.password,
    subject: user.subject,
  }));
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status} ${response.statusText}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text.trim()) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

async function createPasswordAdminToken(baseUrl: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username: trimEnv("KEYCLOAK_ADMIN", "admin"),
    password: trimEnv("KEYCLOAK_ADMIN_PASSWORD", "admin"),
  });

  const payload = await requestJson<{ access_token: string }>(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  return payload.access_token;
}

async function createServiceAdminToken(baseUrl: string): Promise<string> {
  const clientId = resolveOptionalEnv("KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_ID");
  const clientSecret = resolveOptionalEnv("KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Missing KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_ID or KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET.");
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const payload = await requestJson<{ access_token: string }>(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  return payload.access_token;
}

async function createAdminToken(baseUrl: string): Promise<string> {
  if (
    resolveOptionalEnv("KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_ID")
    && resolveOptionalEnv("KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET")
  ) {
    return await createServiceAdminToken(baseUrl);
  }
  return await createPasswordAdminToken(baseUrl);
}

async function waitForAdminToken(baseUrl: string, attempts = 60): Promise<string> {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await createAdminToken(baseUrl);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for Keycloak admin token.");
}

async function findUser(baseUrl: string, realm: string, token: string, username: string): Promise<KeycloakUser | null> {
  const users = await requestJson<KeycloakUser[]>(
    `${baseUrl}/admin/realms/${realm}/users?username=${encodeURIComponent(username)}&exact=true`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );
  const normalizedUsername = username.trim().toLowerCase();
  return users.find(user => user.username.trim().toLowerCase() === normalizedUsername) ?? null;
}

async function findClient(baseUrl: string, realm: string, token: string, clientId: string): Promise<KeycloakClient | null> {
  const clients = await requestJson<KeycloakClient[]>(
    `${baseUrl}/admin/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );
  return clients[0] ?? null;
}

async function ensurePortalClient(baseUrl: string, realm: string, token: string): Promise<void> {
  const client = await findClient(baseUrl, realm, token, trimEnv("KEYCLOAK_CLIENT_ID", "speclens-web"));
  if (!client) {
    throw new Error("Keycloak client speclens-web was not found.");
  }

  const baseOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3300",
    "http://127.0.0.1:3300",
  ];
  const extraBases = [
    resolveOptionalEnv("APP_URL"),
    resolveOptionalEnv("PLAYWRIGHT_BASE_URL"),
    resolveOptionalEnv("E2E_BASE_URL"),
    resolveOptionalEnv("KEYCLOAK_BASE_URL"),
  ].filter(Boolean) as string[];
  for (const base of extraBases.map(normalizeBaseUrl)) {
    baseOrigins.push(base);
  }
  const redirectOverride = resolveOptionalEnv("KEYCLOAK_REDIRECT_URIS");
  const webOriginsOverride = resolveOptionalEnv("KEYCLOAK_WEB_ORIGINS");
  const defaultRedirectUris = Array.from(new Set(baseOrigins.flatMap(origin => [
    `${origin}/*`,
    `${origin}/api/auth/callback`,
    `${origin}/api/auth/callback*`,
  ])));
  const defaultOrigins = Array.from(new Set(baseOrigins));
  const redirectUris = redirectOverride
    ? redirectOverride.split(",").map(value => value.trim()).filter(Boolean)
    : defaultRedirectUris;
  const origins = webOriginsOverride
    ? webOriginsOverride.split(",").map(value => value.trim()).filter(Boolean)
    : defaultOrigins;

  await requestJson<void>(`${baseUrl}/admin/realms/${realm}/clients/${client.id}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...client,
      redirectUris,
      webOrigins: origins,
      attributes: {
        ...(client.attributes ?? {}),
        "post.logout.redirect.uris": "+",
      },
    }),
  });
}

async function ensureUser(baseUrl: string, realm: string, token: string, user: SeedUser): Promise<KeycloakUser> {
  const existing = await findUser(baseUrl, realm, token, user.username);
  const body = {
    username: user.username,
    email: user.email,
    enabled: true,
    emailVerified: true,
    firstName: user.displayName.split(" ")[0] ?? user.displayName,
    lastName: user.displayName.split(" ").slice(1).join(" "),
  };
  const bodyWithId = user.subject ? { ...body, id: user.subject } : body;

  if (!existing) {
    await requestJson<void>(`${baseUrl}/admin/realms/${realm}/users`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(bodyWithId),
    });
    const created = await findUser(baseUrl, realm, token, user.username);
    if (!created) {
      throw new Error(`Failed to create Keycloak user ${user.username}.`);
    }
    return created;
  }

  await requestJson<void>(`${baseUrl}/admin/realms/${realm}/users/${existing.id}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...body,
      id: existing.id,
    }),
  });
  return existing;
}

async function setPassword(baseUrl: string, realm: string, token: string, userId: string, password: string): Promise<void> {
  await requestJson<void>(`${baseUrl}/admin/realms/${realm}/users/${userId}/reset-password`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "password",
      temporary: false,
      value: password,
    }),
  });
}

async function main(): Promise<void> {
  const baseUrl = deriveAdminBaseUrl();
  const realm = realmName();
  const token = await waitForAdminToken(baseUrl);

  await ensurePortalClient(baseUrl, realm, token);

  const seedUsers = resolveSeedUsers();
  for (const user of seedUsers) {
    const ensured = await ensureUser(baseUrl, realm, token, user);
    await setPassword(baseUrl, realm, token, ensured.id, user.password);
  }
}

void main().catch(error => {
  console.error("[seed-keycloak-users] failed", error);
  process.exitCode = 1;
});
