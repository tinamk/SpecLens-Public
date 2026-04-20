import assert from "node:assert/strict";
import test from "node:test";
import { ensureTestAuthSecrets } from "./helpers/portal-auth";

function clearKeycloakEnv(): void {
  delete process.env.KEYCLOAK_ISSUER_URL;
  delete process.env.KEYCLOAK_INTERNAL_ISSUER_URL;
  delete process.env.KEYCLOAK_CLIENT_ID;
  delete process.env.KEYCLOAK_CLIENT_SECRET;
  delete process.env.KEYCLOAK_BASE_URL;
}

test("web auth login route sets a local portal session cookie and preserves returnTo", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  const route = await import("../apps/web/app/api/auth/login/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/login?returnTo=/portal/workspaces/demo"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/portal/workspaces/demo");
  assert.equal((response.headers.get("set-cookie") ?? "").includes("speclens_portal_session="), true);

  process.env = originalEnv;
});

test("web auth login route rejects external returnTo targets", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  const route = await import("../apps/web/app/api/auth/login/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/login?returnTo=https://attacker.example/phish"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/portal/workspaces");

  process.env = originalEnv;
});

test("web auth login route normalizes Keycloak callback returnTo targets", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  process.env.KEYCLOAK_ISSUER_URL = "http://localhost:8081/realms/speclens";
  process.env.KEYCLOAK_CLIENT_ID = "speclens-web";

  const route = await import("../apps/web/app/api/auth/login/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/login?returnTo=https://attacker.example/phish"));

  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location") ?? "");
  const redirectUri = new URL(location.searchParams.get("redirect_uri") ?? "http://localhost:3000/api/auth/callback");
  assert.equal(redirectUri.origin, "http://localhost:3000");
  assert.equal(redirectUri.pathname, "/api/auth/callback");
  assert.equal(redirectUri.searchParams.get("returnTo"), "/portal/workspaces");

  process.env = originalEnv;
});

test("web auth login route redirects to Keycloak when configured", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  process.env.KEYCLOAK_ISSUER_URL = "http://localhost:8081/realms/speclens";
  process.env.KEYCLOAK_CLIENT_ID = "speclens-web";

  const route = await import("../apps/web/app/api/auth/login/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/login?returnTo=/portal"));

  assert.equal(response.status, 307);
  const location = response.headers.get("location") ?? "";
  assert.equal(location.startsWith("http://localhost:8081/realms/speclens/protocol/openid-connect/auth"), true);
  assert.equal(location.includes("client_id=speclens-web"), true);
  assert.equal((response.headers.get("set-cookie") ?? "").includes("speclens_oidc_state="), true);

  process.env = originalEnv;
});

test("web auth callback route rejects external returnTo targets in local dev mode", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  const route = await import("../apps/web/app/api/auth/callback/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/callback?returnTo=https://attacker.example/phish"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/portal/workspaces");

  process.env = originalEnv;
});

test("web auth logout route clears the local portal session cookie", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  const route = await import("../apps/web/app/api/auth/logout/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/logout"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/pricing");
  assert.equal((response.headers.get("set-cookie") ?? "").includes("speclens_portal_session="), true);

  process.env = originalEnv;
});

test("web proxy forwards Keycloak bearer token and session cookie to the API", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.INTERNAL_API_URL = "http://api:4000";

  let capturedAuthorization: string | null = null;
  let capturedCookie: string | null = null;
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    capturedAuthorization = headers.get("authorization");
    capturedCookie = headers.get("cookie");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof fetch;

  const route = await import("../apps/web/app/api/proxy/[...path]/route");
  const response = await route.GET(
    new Request("http://localhost:3000/api/proxy/api/me", {
      headers: {
        cookie: [
          "speclens_portal_session=demo-session",
          "speclens_portal_id_token=demo-token",
        ].join("; "),
      },
    }),
    {
      params: Promise.resolve({
        path: ["api", "me"],
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedAuthorization, "Bearer demo-token");
  assert.equal(capturedCookie, "speclens_portal_session=demo-session");

  global.fetch = originalFetch;
  process.env = originalEnv;
});

test("web proxy forwards multipart request bodies without text conversion", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.INTERNAL_API_URL = "http://api:4000";

  let capturedBody: Uint8Array | null = null;
  let capturedContentType: string | null = null;
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    capturedContentType = headers.get("content-type");
    if (init?.body instanceof Uint8Array) {
      capturedBody = init.body;
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof fetch;

  const route = await import("../apps/web/app/api/proxy/[...path]/route");
  const body = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const response = await route.POST(
    new Request("http://localhost:3000/api/proxy/api/workspaces/demo/uploads", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=demo",
      },
      body,
    }),
    {
      params: Promise.resolve({
        path: ["api", "workspaces", "demo", "uploads"],
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedContentType, "multipart/form-data; boundary=demo");
  assert.deepEqual(Array.from(capturedBody ?? []), Array.from(body));

  global.fetch = originalFetch;
  process.env = originalEnv;
});

test("web request-origin ignores forwarded host headers on untrusted public request hosts", async () => {
  const module = await import("../apps/web/lib/request-origin");
  const origin = module.resolvePublicRequestOrigin({
    requestUrl: "https://public.speclens.example/api/auth/login",
    forwardedProto: "https",
    forwardedHost: "attacker.example",
    configuredBaseUrl: "https://public.speclens.example",
  });

  assert.equal(origin, "https://public.speclens.example");
});

test("web request-origin honors forwarded host headers behind trusted local proxies", async () => {
  const module = await import("../apps/web/lib/request-origin");
  const origin = module.resolvePublicRequestOrigin({
    requestUrl: "http://web:3000/api/auth/login",
    forwardedProto: "https",
    forwardedHost: "app.speclens.example",
    configuredBaseUrl: "https://app.speclens.example",
  });

  assert.equal(origin, "https://app.speclens.example");
});
