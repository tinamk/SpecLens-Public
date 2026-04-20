function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}

const DEFAULT_INTERNAL_SERVICE_HOSTNAMES = new Set([
  "api",
  "web",
  "runner",
  "ai-worker",
  "keycloak",
  "postgres",
  "minio",
  "caddy",
]);

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
}

function isIpv4InCidr(hostname: string, firstOctet: number, secondOctetMin: number, secondOctetMax: number): boolean {
  const parts = hostname.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [part0, part1] = parts;
  if (part0 === undefined || part1 === undefined) {
    return false;
  }
  return part0 === firstOctet && part1 >= secondOctetMin && part1 <= secondOctetMax;
}

function isExactIpv4Network(hostname: string, firstOctet: number, secondOctet: number): boolean {
  const parts = hostname.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === firstOctet && parts[1] === secondOctet;
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  if (isLoopbackHostname(hostname)) {
    return true;
  }

  return isIpv4InCidr(hostname, 10, 0, 255)
    || isIpv4InCidr(hostname, 172, 16, 31)
    || isExactIpv4Network(hostname, 192, 168)
    || isIpv4InCidr(hostname, 100, 64, 127);
}

export function isTrustedInternalServiceHostname(
  hostname: string,
  rawAllowList: string | null | undefined = process.env.SPECLENS_INTERNAL_SERVICE_HOSTNAMES,
): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized || normalized.includes(".")) {
    return false;
  }

  const allowList = new Set(DEFAULT_INTERNAL_SERVICE_HOSTNAMES);
  for (const value of (rawAllowList ?? "").split(",")) {
    const entry = value.trim().toLowerCase();
    if (entry) {
      allowList.add(entry);
    }
  }
  return allowList.has(normalized);
}

export function isTrustedLocalHostname(
  hostname: string,
  rawAllowList: string | null | undefined = process.env.SPECLENS_INTERNAL_SERVICE_HOSTNAMES,
): boolean {
  return isPrivateOrLocalHostname(hostname) || isTrustedInternalServiceHostname(hostname, rawAllowList);
}

export function resolvePublicRequestOrigin(input: {
  requestUrl: string;
  forwardedProto?: string | null;
  forwardedHost?: string | null;
  forwardedPort?: string | null;
  configuredBaseUrl?: string | null;
}): string {
  const forwardedProto = input.forwardedProto?.trim();
  const forwardedHost = input.forwardedHost?.trim();
  const forwardedPort = input.forwardedPort?.trim();
  if (forwardedProto && forwardedHost) {
    const needsPort = forwardedPort
      && !forwardedHost.includes(":")
      && !((forwardedProto === "http" && forwardedPort === "80") || (forwardedProto === "https" && forwardedPort === "443"));
    return normalizeOrigin(`${forwardedProto}://${forwardedHost}${needsPort ? `:${forwardedPort}` : ""}`);
  }

  if (input.configuredBaseUrl?.trim()) {
    return normalizeOrigin(input.configuredBaseUrl.trim());
  }

  return normalizeOrigin(input.requestUrl);
}

export function isAllowedDynamicReturnOrigin(origin: string, allowList: string[] = []): boolean {
  const normalized = normalizeOrigin(origin);
  const url = new URL(normalized);
  if (isPrivateOrLocalHostname(url.hostname)) {
    return true;
  }

  return allowList
    .map(value => value.trim())
    .filter(Boolean)
    .some(value => {
      try {
        return normalizeOrigin(value) === normalized;
      } catch {
        return false;
      }
    });
}

export function parseAllowedOrigins(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}
