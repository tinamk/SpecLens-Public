#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-.env}"

if [ ! -f "$env_file" ]; then
  echo "Missing $env_file. Create it from .env.example first."
  exit 1
fi

host_ip="${HOST_IP_OVERRIDE:-${PUBLIC_HOST_OVERRIDE:-}}"

if [ -z "$host_ip" ] && command -v tailscale >/dev/null 2>&1; then
  host_ip="$(tailscale ip -4 2>/dev/null | head -n 1)"
fi

if [ -z "$host_ip" ] && command -v ip >/dev/null 2>&1; then
  host_ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
fi

if [ -z "$host_ip" ] && command -v hostname >/dev/null 2>&1; then
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi

if [ -z "$host_ip" ]; then
  echo "Could not determine a public host. Set HOST_IP_OVERRIDE or PUBLIC_HOST_OVERRIDE to the desired LAN/Tailscale host."
  exit 1
fi

upsert() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$env_file"; then
    perl -pi -e "s|^${key}=.*$|${key}=${value}|" "$env_file"
  else
    echo "${key}=${value}" >> "$env_file"
  fi
}

upsert "HOST_IP" "$host_ip"
upsert "APP_URL" "http://${host_ip}:8080"
upsert "API_URL" "http://${host_ip}:8080"
upsert "NEXT_PUBLIC_API_URL" "http://${host_ip}:8080"
upsert "KEYCLOAK_ISSUER_URL" "http://${host_ip}:8080/auth/realms/speclens"
upsert "KEYCLOAK_BASE_URL" "http://${host_ip}:8080"
upsert "STRIPE_SUCCESS_URL" "http://${host_ip}:8080/portal?billing=success"
upsert "STRIPE_CANCEL_URL" "http://${host_ip}:8080/pricing?billing=cancelled"
upsert "GITHUB_LOCAL_WEBHOOK_TARGET_URL" "http://${host_ip}:8080/api/webhooks/github"
upsert "GITHUB_ALLOWED_RETURN_ORIGINS" "http://${host_ip}:8080"

echo "Updated $env_file for public host ${host_ip}"
