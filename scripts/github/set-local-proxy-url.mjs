import { updateDotEnvValue } from "../_env.mjs";

const proxyUrl = process.argv[2]?.trim();

if (!proxyUrl || !proxyUrl.startsWith("https://smee.io/")) {
  console.error("Usage: npm run github:webhooks:set-proxy -- https://smee.io/...");
  process.exit(1);
}

updateDotEnvValue("GITHUB_LOCAL_WEBHOOK_PROXY_URL", proxyUrl);
console.log("Updated GITHUB_LOCAL_WEBHOOK_PROXY_URL in .env");
