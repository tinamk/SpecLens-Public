import { isTrustedLocalHostname } from "@speclens/core";

function safeOrigin(value: string | null | undefined): string | null {
  if (!value || value.trim().length === 0) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function resolveInternalApiBaseUrl(): string {
  return process.env.INTERNAL_API_URL ?? process.env.API_URL ?? "http://localhost:4000";
}

export function isTrustedPortalApiBaseUrl(baseUrl: string = resolveInternalApiBaseUrl()): boolean {
  try {
    const url = new URL(baseUrl);
    if (isTrustedLocalHostname(url.hostname)) {
      return true;
    }

    const appOrigin = safeOrigin(process.env.APP_URL ?? null);
    if (appOrigin && appOrigin === url.origin) {
      return true;
    }

    const allowList = (process.env.TRUSTED_INTERNAL_API_ORIGINS ?? "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);
    return allowList.some(value => safeOrigin(value) === url.origin);
  } catch {
    return false;
  }
}

export function assertTrustedPortalApiBaseUrl(baseUrl: string = resolveInternalApiBaseUrl()): string {
  if (!isTrustedPortalApiBaseUrl(baseUrl)) {
    throw new Error(
      `Refusing to forward portal credentials to untrusted API origin ${baseUrl}. `
      + "Use a private/local INTERNAL_API_URL or set TRUSTED_INTERNAL_API_ORIGINS explicitly.",
    );
  }
  return baseUrl;
}
