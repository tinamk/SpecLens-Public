import crypto from "node:crypto";
import { readConfigValue } from "./_env.mjs";

function makeLocalDevSessionCookie() {
  const payload = {
    provider: "local-dev",
    subject: "stripe-local-cli",
    email: "stripe-local@speclens.dev",
    displayName: "Stripe Local",
  };
  const sessionSecret = readConfigValue("PORTAL_SESSION_SECRET", readConfigValue("CSRF_SECRET", ""));
  const csrfSecret = readConfigValue("CSRF_SECRET", readConfigValue("PORTAL_SESSION_SECRET", ""));
  if (!sessionSecret || !csrfSecret) {
    throw new Error("PORTAL_SESSION_SECRET or CSRF_SECRET is required for signed local-dev checkout auth.");
  }
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
  const sessionToken = `${body}.${signature}`;
  const csrfToken = crypto.createHmac("sha256", csrfSecret).update(sessionToken).digest("hex");
  return {
    cookie: `speclens_portal_session=${sessionToken}; speclens_csrf=${csrfToken}`,
    csrfToken,
  };
}

async function apiFetch(pathname, init = {}) {
  const port = readConfigValue("PORT", "4000");
  const baseUrl = readConfigValue("STRIPE_LOCAL_API_URL", `http://localhost:${port}`);
  const localDevAuth = makeLocalDevSessionCookie();
  const headers = new Headers(init.headers ?? {});
  headers.set("content-type", "application/json");
  headers.set("cookie", localDevAuth.cookie);
  if ((init.method ?? "GET").toUpperCase() !== "GET" && (init.method ?? "GET").toUpperCase() !== "HEAD") {
    headers.set("x-csrf-token", localDevAuth.csrfToken);
  }
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${pathname} -> ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

const authMode = readConfigValue("API_AUTH_MODE", "keycloak");
if (authMode !== "local-dev") {
  console.error("stripe:webhooks:create-checkout is for local-dev auth mode.");
  console.error("With Keycloak enabled, create the checkout from http://localhost:3000 after logging in.");
  console.error("If you want a pure CLI loop, start the API with API_AUTH_MODE=local-dev and rerun this command.");
  process.exit(1);
}

const workspace = await apiFetch("/api/workspaces", {
  method: "POST",
  body: JSON.stringify({
    name: "Stripe CLI Local Checkout",
    description: "Temporary workspace created for localhost webhook verification.",
  }),
});

const checkout = await apiFetch("/api/billing/checkout", {
  method: "POST",
  body: JSON.stringify({
    workspaceId: workspace.workspace.id,
    plan: "pro",
  }),
});

console.log(JSON.stringify({
  workspaceId: workspace.workspace.id,
  checkoutSessionId: checkout.checkoutSessionId,
  checkoutUrl: checkout.checkoutUrl,
  provider: checkout.provider,
}, null, 2));
