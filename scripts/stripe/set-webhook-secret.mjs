import { updateDotEnvValue } from "./_env.mjs";

const secret = process.argv[2]?.trim();

if (!secret || !secret.startsWith("whsec_")) {
  console.error("Usage: npm run stripe:webhooks:set-secret -- whsec_...");
  process.exit(1);
}

updateDotEnvValue("STRIPE_WEBHOOK_SECRET", secret);
console.log("Updated STRIPE_WEBHOOK_SECRET in .env");
