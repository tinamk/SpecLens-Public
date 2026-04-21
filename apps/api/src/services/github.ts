import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createGithubAppJwt,
  createGithubInstallationAccessToken,
  isAllowedDynamicReturnOrigin,
  parseGithubRepoLocation as parseGithubRepoLocationCore,
  parseAllowedOrigins,
  resolvePublicRequestOrigin,
  resolveSpecLensCacheRoot,
} from "@speclens/core";
import { createGithubInstallUrl, statusError } from "@speclens/db";
import { githubGatewayRegisterInputSchema, type GithubGatewayRegisterInput, type GithubWebhookTarget } from "@speclens/contracts";

export { createGithubAppJwt };

export type GithubInstallationRecord = {
  id: number;
  accountLogin: string;
  accountType: string;
};

export type GithubRepositoryRecord = {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  private: boolean;
  defaultBranch: string;
};

export type GithubPullRequestRecord = {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  url: string;
  headRef: string;
  baseRef: string;
  changedFiles: number | null;
  mergeable: boolean | null;
  updatedAt: string;
};

export type GithubWebhookParseResult =
  | {
      kind: "handled";
      eventName: string;
      payload: {
        action: "created" | "deleted";
        installationId: string;
        accountLogin: string;
      };
    }
  | {
      kind: "ignored";
      eventName: string;
      action?: string;
    };

type GithubInstallStatePayload = {
  intentId: string;
  nonce: string;
};

function readEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function safeCacheKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function githubApiCacheRoot(): string {
  return path.join(resolveSpecLensCacheRoot(process.env), "github-api");
}

function getGithubApiCacheRetentionMs(): number {
  const value = Number.parseInt(readEnv("GITHUB_API_CACHE_RETENTION_MS") ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 24 * 60 * 60 * 1000;
}

function getGithubPullRequestCacheTtlMs(): number {
  const value = Number.parseInt(readEnv("GITHUB_PULL_REQUEST_CACHE_TTL_MS") ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 60_000;
}

function cleanupGithubApiCache(): void {
  const root = githubApiCacheRoot();
  if (!fs.existsSync(root)) {
    return;
  }
  const cutoff = Date.now() - getGithubApiCacheRetentionMs();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    try {
      const stats = fs.statSync(fullPath);
      if (stats.mtimeMs < cutoff) {
        fs.rmSync(fullPath, { force: true });
      }
    } catch {
      // Ignore stale cache entries and cleanup races.
    }
  }
}

function readGithubCache<T>(cacheKey: string, ttlMs: number): T | null {
  const cachePath = path.join(githubApiCacheRoot(), `${safeCacheKey(cacheKey)}.json`);
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  const stats = fs.statSync(cachePath);
  if (Date.now() - stats.mtimeMs > ttlMs) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeGithubCache(cacheKey: string, payload: unknown): void {
  const cacheDir = githubApiCacheRoot();
  cleanupGithubApiCache();
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `${safeCacheKey(cacheKey)}.json`);
  fs.writeFileSync(cachePath, `${JSON.stringify(payload)}\n`, "utf8");
}

async function withGithubCache<T>(cacheKey: string, producer: () => Promise<T>): Promise<T> {
  cleanupGithubApiCache();
  const ttlMs = getGithubPullRequestCacheTtlMs();
  const cached = readGithubCache<T>(cacheKey, ttlMs);
  if (cached) {
    return cached;
  }
  const payload = await producer();
  writeGithubCache(cacheKey, payload);
  return payload;
}

function slugifyAppName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function readGithubStateSigningSecret(): string {
  const secret = readEnv("GITHUB_STATE_SIGNING_SECRET")
    ?? readEnv("GITHUB_GATEWAY_REGISTRATION_TOKEN")
    ?? readEnv("APP_STATE_ENCRYPTION_KEY")
    ?? readEnv("CSRF_SECRET")
    ?? readEnv("PORTAL_SESSION_SECRET");
  if (!secret) {
    throw statusError(
      500,
      "GitHub install state signing requires GITHUB_STATE_SIGNING_SECRET or an app state secret such as APP_STATE_ENCRYPTION_KEY.",
    );
  }
  return secret;
}

export function getGithubGatewayUrl(): string | null {
  return readEnv("GITHUB_GATEWAY_URL");
}

export function getGithubGatewayDomain(): string | null {
  const explicit = readEnv("GITHUB_GATEWAY_DOMAIN");
  if (explicit) {
    return explicit;
  }
  const gatewayUrl = getGithubGatewayUrl();
  return gatewayUrl ? new URL(gatewayUrl).hostname : null;
}

export function getGithubWebhookTargetTtlSeconds(): number {
  const value = Number.parseInt(readEnv("GITHUB_WEBHOOK_TARGET_TTL_SECONDS") ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 300;
}

export function getGithubGatewayForwardTimeoutMs(): number {
  const value = Number.parseInt(readEnv("GITHUB_GATEWAY_FORWARD_TIMEOUT_MS") ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 5_000;
}

export function createSignedGithubInstallState(payload: GithubInstallStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", readGithubStateSigningSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function parseSignedGithubInstallState(state: string): GithubInstallStatePayload {
  const [body, signature] = state.split(".");
  if (!body || !signature) {
    throw statusError(400, "Invalid GitHub install state.");
  }
  const expected = crypto.createHmac("sha256", readGithubStateSigningSecret()).update(body).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw statusError(400, "Invalid GitHub install state signature.");
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<GithubInstallStatePayload>;
    if (typeof payload.intentId !== "string" || typeof payload.nonce !== "string") {
      throw new Error("missing fields");
    }
    return {
      intentId: payload.intentId,
      nonce: payload.nonce,
    };
  } catch {
    throw statusError(400, "Invalid GitHub install state payload.");
  }
}

export function resolveGithubRequestOrigin(input: {
  requestUrl: string;
  forwardedProto?: string | null;
  forwardedHost?: string | null;
  forwardedPort?: string | null;
  configuredBaseUrl?: string | null;
}): string {
  return resolvePublicRequestOrigin(input);
}

export function assertAllowedGithubReturnOrigin(origin: string): string {
  const normalized = new URL(origin).origin;
  if (!isAllowedDynamicReturnOrigin(normalized, parseAllowedOrigins(readEnv("GITHUB_ALLOWED_RETURN_ORIGINS")))) {
    throw statusError(400, `Unsupported GitHub return origin: ${normalized}`);
  }
  return normalized;
}

export function isGithubGatewayHost(hostname: string | null | undefined): boolean {
  if (!hostname) {
    return false;
  }
  const normalized = hostname.split(":")[0] ?? hostname;
  return normalized === getGithubGatewayDomain();
}

export function resolveGithubInstallBaseUrl(): string {
  const explicit = readEnv("GITHUB_APP_INSTALL_URL");
  if (explicit) {
    return explicit;
  }
  const slug = readEnv("GITHUB_APP_SLUG");
  if (slug) {
    return `https://github.com/apps/${slug}/installations/new`;
  }
  const appName = readEnv("GITHUB_APP_NAME");
  if (appName) {
    return `https://github.com/apps/${slugifyAppName(appName)}/installations/new`;
  }
  return "https://github.com/apps/speclens/installations/new";
}

export function buildGithubInstallUrl(state: string): string {
  return createGithubInstallUrl(state, resolveGithubInstallBaseUrl());
}

async function githubApiFetch<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "SpecLens/0.4.0",
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw statusError(response.status, text || `GitHub API request failed for ${pathname}.`);
  }
  return await response.json() as T;
}

async function githubRepoFetch<T>(repoLocation: string, installationId: string | null, pathname: string): Promise<T> {
  const { owner, repo } = parseGithubRepoLocation(repoLocation);
  const token = installationId
    ? await createGithubInstallationAccessToken(installationId)
    : readEnv("GITHUB_API_TOKEN");
  return githubApiFetch<T>(`/repos/${owner}/${repo}${pathname}`, {
    headers: token ? { authorization: `token ${token}` } : {},
  });
}

export async function getGithubInstallation(installationId: string): Promise<GithubInstallationRecord> {
  const jwt = await createGithubAppJwt();
  const payload = await githubApiFetch<{
    id: number;
    account: {
      login: string;
      type: string;
    } | null;
  }>(`/app/installations/${installationId}`, {
    headers: {
      authorization: `Bearer ${jwt}`,
    },
  });

  if (!payload.account) {
    throw statusError(404, `GitHub installation ${installationId} has no account.`);
  }

  return {
    id: payload.id,
    accountLogin: payload.account.login,
    accountType: payload.account.type,
  };
}

export function parseGithubRepoLocation(location: string): {
  owner: string;
  repo: string;
  normalizedUrl: string;
} {
  const parsed = parseGithubRepoLocationCore(location);
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    normalizedUrl: `https://github.com/${parsed.owner}/${parsed.repo}.git`,
  };
}

export function isGithubRepoLocation(location: string): boolean {
  try {
    parseGithubRepoLocation(location);
    return true;
  } catch {
    return false;
  }
}

export async function listGithubInstallationRepositories(installationId: string): Promise<GithubRepositoryRecord[]> {
  const token = await createGithubInstallationAccessToken(installationId);
  const payload = await githubApiFetch<{
    repositories: Array<{
      id: number;
      name: string;
      full_name: string;
      html_url: string;
      clone_url: string;
      private: boolean;
      default_branch?: string;
    }>;
  }>("/installation/repositories", {
    headers: {
      authorization: `token ${token}`,
    },
  });

  return payload.repositories.map(repository => ({
    id: repository.id,
    name: repository.name,
    fullName: repository.full_name,
    htmlUrl: repository.html_url,
    cloneUrl: repository.clone_url,
    private: repository.private,
    defaultBranch: repository.default_branch ?? "main",
  }));
}

export async function listGithubPullRequests(repoLocation: string, installationId: string | null): Promise<GithubPullRequestRecord[]> {
  return withGithubCache(
    `pulls:list:${installationId ?? "anonymous"}:${repoLocation}`,
    async () => {
      const items: GithubPullRequestRecord[] = [];
      for (let page = 1; page <= 5; page += 1) {
        const payload = await githubRepoFetch<Array<{
          number: number;
          title: string;
          html_url: string;
          state: "open" | "closed";
          merged_at: string | null;
          updated_at: string;
          head: { ref: string };
          base: { ref: string };
        }>>(repoLocation, installationId, `/pulls?state=all&per_page=100&page=${page}`);
        items.push(...payload.map(item => ({
          number: item.number,
          title: item.title,
          state: (item.merged_at ? "merged" : item.state) as GithubPullRequestRecord["state"],
          url: item.html_url,
          headRef: item.head.ref,
          baseRef: item.base.ref,
          changedFiles: null,
          mergeable: null,
          updatedAt: item.updated_at,
        })));
        if (payload.length < 100) {
          break;
        }
      }
      return items;
    },
  );
}

export async function verifyGithubRepositoryAccess(repoLocation: string, installationId: string | null): Promise<void> {
  await githubRepoFetch<{
    id: number;
    private: boolean;
    html_url: string;
  }>(repoLocation, installationId, "");
}

export async function getGithubPullRequest(repoLocation: string, installationId: string | null, number: number): Promise<GithubPullRequestRecord> {
  return withGithubCache(
    `pulls:detail:${installationId ?? "anonymous"}:${repoLocation}:${number}`,
    async () => {
      const payload = await githubRepoFetch<{
        number: number;
        title: string;
        html_url: string;
        state: "open" | "closed";
        merged_at: string | null;
        updated_at: string;
        changed_files?: number;
        mergeable?: boolean | null;
        head: { ref: string };
        base: { ref: string };
      }>(repoLocation, installationId, `/pulls/${number}`);
      return {
        number: payload.number,
        title: payload.title,
        state: payload.merged_at ? "merged" : payload.state,
        url: payload.html_url,
        headRef: payload.head.ref,
        baseRef: payload.base.ref,
        changedFiles: payload.changed_files ?? 0,
        mergeable: payload.mergeable ?? null,
        updatedAt: payload.updated_at,
      };
    },
  );
}

export function selectGithubInstallationForRepo(
  installations: Array<{ githubInstallationId: string; githubAccountLogin: string }>,
  repoLocation: string,
): { githubInstallationId: string; githubAccountLogin: string } | null {
  if (installations.length === 0) {
    return null;
  }
  const { owner } = parseGithubRepoLocation(repoLocation);
  const exact = installations.find(installation => installation.githubAccountLogin.toLowerCase() === owner.toLowerCase());
  if (exact) {
    return exact;
  }
  return installations.length === 1 ? installations[0] ?? null : null;
}

export function parseGithubWebhookPayload(request: {
  headers: {
    "x-github-event"?: string | string[] | undefined;
    "x-hub-signature-256"?: string | string[] | undefined;
  };
  body: unknown;
  rawBody?: Buffer | null;
}): GithubWebhookParseResult {
  const eventName = Array.isArray(request.headers["x-github-event"])
    ? request.headers["x-github-event"][0]
    : request.headers["x-github-event"];
  const signature = Array.isArray(request.headers["x-hub-signature-256"])
    ? request.headers["x-hub-signature-256"][0]
    : request.headers["x-hub-signature-256"];
  const secret = readEnv("GITHUB_APP_WEBHOOK_SECRET");
  if (!secret) {
    throw statusError(503, "GITHUB_APP_WEBHOOK_SECRET is required to accept GitHub webhooks.");
  }
  if (!eventName) {
    throw statusError(400, "Missing GitHub webhook event header.");
  }
  if (!signature) {
    throw statusError(401, "Missing GitHub webhook signature.");
  }
  if (!request.rawBody) {
    throw statusError(400, "Raw request body is required to verify GitHub webhook signatures.");
  }
  const digest = Buffer.from(`sha256=${crypto.createHmac("sha256", secret).update(request.rawBody).digest("hex")}`);
  const received = Buffer.from(signature);
  if (digest.length !== received.length || !crypto.timingSafeEqual(digest, received)) {
    throw statusError(401, "Invalid GitHub webhook signature.");
  }

  const payload = request.rawBody
    ? JSON.parse(request.rawBody.toString("utf8")) as Record<string, unknown>
    : typeof request.body === "string"
      ? JSON.parse(request.body) as Record<string, unknown>
      : request.body as Record<string, unknown>;
  if (eventName === "ping") {
    return {
      kind: "ignored",
      eventName,
    };
  }
  if (eventName !== "installation") {
    return {
      kind: "ignored",
      eventName: eventName ?? "unknown",
      ...(typeof payload.action === "string" ? { action: payload.action } : {}),
    };
  }

  const action = payload.action === "deleted" ? "deleted" : payload.action === "created" ? "created" : null;
  const installationId = typeof (payload.installation as { id?: unknown } | undefined)?.id === "number"
    ? String((payload.installation as { id: number }).id)
    : null;
  const accountLogin = typeof (payload.installation as { account?: { login?: unknown } } | undefined)?.account?.login === "string"
    ? String((payload.installation as { account: { login: string } }).account.login)
    : typeof (payload.account as { login?: unknown } | undefined)?.login === "string"
      ? String((payload.account as { login: string }).login)
      : "";

  if (!action || !installationId) {
    throw statusError(400, "Unsupported GitHub installation webhook payload.");
  }

  return {
    kind: "handled",
    eventName,
    payload: {
      action,
      installationId,
      accountLogin,
    },
  };
}

export function requireGithubGatewayRegistrationToken(authorizationHeader: string | string[] | undefined): void {
  const header = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  const expected = readEnv("GITHUB_GATEWAY_REGISTRATION_TOKEN");
  if (!expected) {
    throw statusError(503, "GITHUB_GATEWAY_REGISTRATION_TOKEN is not configured.");
  }
  if (!header || !header.startsWith("Bearer ")) {
    throw statusError(401, "Missing GitHub gateway registration token.");
  }
  const received = header.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw statusError(401, "Invalid GitHub gateway registration token.");
  }
}

export function parseGithubGatewayRegisterInput(body: unknown): GithubGatewayRegisterInput {
  return githubGatewayRegisterInputSchema.parse(body);
}

export async function forwardGithubWebhookToTarget(
  target: Pick<GithubWebhookTarget, "webhookForwardUrl" | "environmentLabel" | "kind">,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getGithubGatewayForwardTimeoutMs());
  try {
    const response = await fetch(target.webhookForwardUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": Array.isArray(headers["x-github-event"]) ? (headers["x-github-event"][0] ?? "installation") : (headers["x-github-event"] ?? "installation"),
        "x-hub-signature-256": Array.isArray(headers["x-hub-signature-256"]) ? (headers["x-hub-signature-256"][0] ?? "") : (headers["x-hub-signature-256"] ?? ""),
        "x-github-delivery": Array.isArray(headers["x-github-delivery"]) ? (headers["x-github-delivery"][0] ?? "") : (headers["x-github-delivery"] ?? ""),
      },
      body: new Uint8Array(rawBody),
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : await response.text(),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "Unknown webhook forwarding error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
