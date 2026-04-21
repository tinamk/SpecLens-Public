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

caddy_http_port="$(awk -F= '/^CADDY_HTTP_PORT=/{print $2}' "$env_file" | tail -n 1)"
if [ -z "$caddy_http_port" ]; then
  caddy_http_port="18080"
fi

localhost_base="http://localhost:${caddy_http_port}"
public_base="http://${host_ip}:${caddy_http_port}"
keycloak_redirect_uris="${localhost_base}/*,${localhost_base}/api/auth/callback,${localhost_base}/api/auth/callback*,${public_base}/*,${public_base}/api/auth/callback,${public_base}/api/auth/callback*"
keycloak_web_origins="${localhost_base},${public_base}"
github_allowed_return_origins="${localhost_base},${public_base}"

upsert "HOST_IP" "$host_ip"
upsert "APP_URL" "${localhost_base}"
upsert "API_URL" "${localhost_base}"
upsert "NEXT_PUBLIC_API_URL" "${localhost_base}"
upsert "KEYCLOAK_ISSUER_URL" "${localhost_base}/auth/realms/speclens"
upsert "KEYCLOAK_BASE_URL" "${localhost_base}"
upsert "STRIPE_SUCCESS_URL" "${localhost_base}/portal?billing=success"
upsert "STRIPE_CANCEL_URL" "${localhost_base}/pricing?billing=cancelled"
upsert "GITHUB_LOCAL_WEBHOOK_TARGET_URL" "http://127.0.0.1:${caddy_http_port}/api/webhooks/github"
upsert "GITHUB_ALLOWED_RETURN_ORIGINS" "${github_allowed_return_origins}"
upsert "KEYCLOAK_REDIRECT_URIS" "${keycloak_redirect_uris}"
upsert "KEYCLOAK_WEB_ORIGINS" "${keycloak_web_origins}"

echo "Updated $env_file for dual-host local access via localhost and ${host_ip}"
