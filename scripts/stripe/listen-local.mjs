import { spawnSync } from "node:child_process";
import { readConfigValue } from "./_env.mjs";

function resolveForwardUrl() {
  const explicit = readConfigValue("STRIPE_LOCAL_WEBHOOK_FORWARD_URL", "");
  if (explicit) {
    return explicit;
  }

  const port = readConfigValue("PORT", "4000");
  return `http://localhost:${port}/api/webhooks/stripe`;
}

const forwardUrl = resolveForwardUrl();
const events = "checkout.session.completed,customer.subscription.deleted";
const probe = spawnSync("stripe", ["version"], {
  stdio: "ignore",
});

if (probe.status !== 0) {
  console.error("Stripe CLI is required. Install it first, then run `stripe login`.");
  process.exit(1);
}

console.log(`Forwarding Stripe webhooks to ${forwardUrl}`);
console.log("Copy the printed whsec_... value into STRIPE_WEBHOOK_SECRET, or use:");
console.log("npm run stripe:webhooks:set-secret -- whsec_...");
console.log("");

const child = spawnSync("stripe", [
  "listen",
  "--events",
  events,
  "--forward-to",
  forwardUrl,
], {
  stdio: "inherit",
});

process.exit(child.status ?? 0);
