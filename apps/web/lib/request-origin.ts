import { isTrustedLocalHostname } from "@speclens/core";

function withPort(host: string, port: string | null | undefined): string {
  if (!port || host.includes(":")) {
    return host;
  }
  return `${host}:${port}`;
}

function hostnameOfHost(value: string): string {
  return value.replace(/:\d+$/, "");
}

export function resolvePublicRequestOrigin(input: {
  requestUrl: string;
  forwardedProto?: string | null;
  forwardedHost?: string | null;
  forwardedPort?: string | null;
  configuredBaseUrl?: string | null;
}): string {
  const { requestUrl, forwardedProto, forwardedHost, forwardedPort, configuredBaseUrl } = input;
  const fallbackUrl = new URL(requestUrl);
  let configuredOrigin: URL | null = null;

  if (configuredBaseUrl) {
    try {
      configuredOrigin = new URL(configuredBaseUrl);
    } catch {
      configuredOrigin = null;
    }
  }

  const canTrustForwardedHeaders = isTrustedLocalHostname(fallbackUrl.hostname);
  if (forwardedHost && canTrustForwardedHeaders) {
    const protocol = forwardedProto || fallbackUrl.protocol.replace(/:$/, "") || "http";
    if (configuredOrigin && hostnameOfHost(forwardedHost) === configuredOrigin.hostname) {
      return `${protocol}://${configuredOrigin.host}`;
    }
    return `${protocol}://${withPort(forwardedHost, forwardedPort)}`;
  }

  if (configuredOrigin) {
    return configuredOrigin.origin;
  }

  return fallbackUrl.origin;
}
