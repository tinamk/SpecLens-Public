import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload = ""] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

test("Stripe monthly plan config accepts both amount and Stripe price ids", async () => {
  const stripeService = await import("../apps/api/src/services/stripe");

  assert.deepEqual(stripeService.parseStripeMonthlyPriceConfig("19.99"), {
    kind: "amount",
    unitAmount: 1999,
  });
  assert.deepEqual(stripeService.parseStripeMonthlyPriceConfig("price_123"), {
    kind: "price",
    priceId: "price_123",
  });
});

test("workspace secret encryption requires APP_STATE_ENCRYPTION_KEY instead of auth-secret fallbacks", async () => {
  const originalEnv = { ...process.env };

  try {
    delete process.env.APP_STATE_ENCRYPTION_KEY;
    process.env.CSRF_SECRET = "csrf-fallback-secret";
    process.env.PORTAL_SESSION_SECRET = "portal-session-fallback-secret";

    const { encryptSecretValue } = await import("../packages/db/src/repositories");

    assert.throws(
      () => encryptSecretValue("super-secret-value"),
      /APP_STATE_ENCRYPTION_KEY is required for workspace secret encryption/i,
    );
  } finally {
    process.env = originalEnv;
  }
});

test("workspace secret encryption round-trips with APP_STATE_ENCRYPTION_KEY", async () => {
  const originalEnv = { ...process.env };

  try {
    process.env.APP_STATE_ENCRYPTION_KEY = "dedicated-app-state-secret";
    process.env.CSRF_SECRET = "csrf-secret-that-must-not-be-used";
    process.env.PORTAL_SESSION_SECRET = "portal-secret-that-must-not-be-used";

    const { decryptSecretValue, encryptSecretValue } = await import("../packages/db/src/repositories");
    const encrypted = encryptSecretValue("super-secret-value");

    assert.notEqual(encrypted, "super-secret-value");
    assert.equal(decryptSecretValue(encrypted), "super-secret-value");
  } finally {
    process.env = originalEnv;
  }
});

test("GitHub service creates an app JWT from a PKCS8 private key and resolves repo URLs", async () => {
  const originalEnv = { ...process.env };
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({
    format: "pem",
    type: "pkcs8",
  }).toString();

  const githubService = await import("../apps/api/src/services/github");
  const token = await githubService.createGithubAppJwt(1_700_000_000);
  const payload = decodeJwtPayload(token);

  assert.equal(payload.iss, "12345");
  assert.equal(typeof payload.iat, "number");
  assert.equal(typeof payload.exp, "number");
  assert.deepEqual(githubService.parseGithubRepoLocation("https://github.com/example/repo"), {
    owner: "example",
    repo: "repo",
    normalizedUrl: "https://github.com/example/repo.git",
  });
  assert.equal(githubService.isGithubRepoLocation("https://github.com/example/repo"), true);
  assert.equal(githubService.isGithubRepoLocation("https://gitlab.com/github.com/repo.git"), false);
  assert.deepEqual(
    githubService.selectGithubInstallationForRepo(
      [{ githubInstallationId: "1", githubAccountLogin: "example" }],
      "https://github.com/example/repo",
    ),
    { githubInstallationId: "1", githubAccountLogin: "example" },
  );

  process.env = originalEnv;
});

test("GitHub service requires explicit private key configuration", async () => {
  const originalEnv = { ...process.env };
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  delete process.env.GITHUB_APP_PRIVATE_KEY_FILE;

  const githubService = await import("../apps/api/src/services/github");
  await assert.rejects(
    () => githubService.createGithubAppJwt(1_700_000_000),
    /GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_FILE is required/i,
  );

  process.env = originalEnv;
});

test("core GitHub clone auth keeps tokens out of clone URLs and injects git auth via env", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({
      format: "pem",
      type: "pkcs8",
    }).toString();
    global.fetch = (async () => new Response(JSON.stringify({ token: "installation-secret-token" }), {
      status: 201,
      headers: {
        "content-type": "application/json",
      },
    })) as typeof fetch;

    const githubApp = await import("../packages/core/src/github-app");
    const cloneUrl = githubApp.createGithubCloneUrl("https://github.com/example/repo");
    const authEnv = await githubApp.createGithubGitAuthEnv("99", {
      baseEnv: {
        NODE_ENV: process.env.NODE_ENV ?? "test",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "safe.directory",
        GIT_CONFIG_VALUE_0: "/tmp/repo",
      },
    });

    assert.equal(cloneUrl, "https://github.com/example/repo.git");
    assert.equal(authEnv.GIT_CONFIG_COUNT, "2");
    assert.equal(authEnv.GIT_CONFIG_KEY_0, "safe.directory");
    assert.equal(authEnv.GIT_CONFIG_VALUE_0, "/tmp/repo");
    assert.equal(authEnv.GIT_CONFIG_KEY_1, "http.https://github.com/.extraHeader");
    assert.match(authEnv.GIT_CONFIG_VALUE_1 ?? "", /^AUTHORIZATION: basic /);
    assert.equal((authEnv.GIT_CONFIG_VALUE_1 ?? "").includes("installation-secret-token"), false);
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("GitHub gateway state signing and return-origin validation support localhost, LAN, and Tailscale", async () => {
  const originalEnv = { ...process.env };
  process.env.GITHUB_GATEWAY_REGISTRATION_TOKEN = "gateway-secret";
  process.env.GITHUB_ALLOWED_RETURN_ORIGINS = "https://speclens.tinamk.no";

  const githubService = await import("../apps/api/src/services/github");
  const state = githubService.createSignedGithubInstallState({
    intentId: "ghintent_123",
    nonce: "nonce_123",
  });
  assert.deepEqual(githubService.parseSignedGithubInstallState(state), {
    intentId: "ghintent_123",
    nonce: "nonce_123",
  });
  assert.equal(githubService.assertAllowedGithubReturnOrigin("http://localhost:8080"), "http://localhost:8080");
  assert.equal(githubService.assertAllowedGithubReturnOrigin("http://192.168.0.100:8080"), "http://192.168.0.100:8080");
  assert.equal(githubService.assertAllowedGithubReturnOrigin("http://100.69.199.78:8080"), "http://100.69.199.78:8080");
  assert.equal(githubService.assertAllowedGithubReturnOrigin("https://speclens.tinamk.no"), "https://speclens.tinamk.no");
  assert.throws(() => githubService.assertAllowedGithubReturnOrigin("https://example.com"));

  process.env = originalEnv;
});

test("GitHub install state signing falls back to the app state secret", async () => {
  const originalEnv = { ...process.env };
  delete process.env.GITHUB_GATEWAY_REGISTRATION_TOKEN;
  process.env.APP_STATE_ENCRYPTION_KEY = "app-state-secret";

  const githubService = await import("../apps/api/src/services/github");
  const state = githubService.createSignedGithubInstallState({
    intentId: "ghintent_app_secret",
    nonce: "nonce_app_secret",
  });
  assert.deepEqual(githubService.parseSignedGithubInstallState(state), {
    intentId: "ghintent_app_secret",
    nonce: "nonce_app_secret",
  });

  process.env = originalEnv;
});

test("web GitHub callback route links an installation and redirects back to the workspace", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  let capturedBody: string | null = null;
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = typeof init?.body === "string" ? init.body : null;
    return new Response(JSON.stringify({ installation: { id: "inst_1" }, workspaceId: "workspace_demo" }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof fetch;

  process.env.GITHUB_GATEWAY_REGISTRATION_TOKEN = "gateway-secret";
  delete process.env.APP_URL;
  const githubService = await import("../apps/api/src/services/github");
  const state = githubService.createSignedGithubInstallState({
    intentId: "ghintent_demo",
    nonce: "nonce_demo",
  });

  const route = await import("../apps/web/app/auth/github/callback/route");
  const response = await route.GET(new Request(`http://localhost:3000/auth/github/callback?state=${encodeURIComponent(state)}&installation_id=123&setup_action=install`, {
    headers: {
      cookie: [
        "speclens_portal_session=demo-session",
        "speclens_portal_id_token=demo-token",
      ].join("; "),
    },
  }));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:8080/portal/workspaces/workspace_demo/settings?github=connected");
  assert.equal(capturedBody, JSON.stringify({
    state,
    installationId: "123",
  }));

  global.fetch = originalFetch;
  process.env = originalEnv;
});
