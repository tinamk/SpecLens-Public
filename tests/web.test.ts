import assert from "node:assert/strict";
import test from "node:test";

test("web auth login route sets a local portal session cookie and preserves returnTo", async () => {
  const route = await import("../apps/web/app/api/auth/login/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/login?returnTo=/portal/workspaces/demo"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/portal/workspaces/demo");
  assert.equal((response.headers.get("set-cookie") ?? "").includes("speclens_portal_session="), true);
});

test("web auth login route redirects to Keycloak when configured", async () => {
  const originalEnv = { ...process.env };
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

test("web auth logout route clears the local portal session cookie", async () => {
  const route = await import("../apps/web/app/api/auth/logout/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/logout"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/");
  assert.equal((response.headers.get("set-cookie") ?? "").includes("speclens_portal_session="), true);
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
