import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SignJWT } from "jose";

function readGithubEnv(name: string, env: NodeJS.ProcessEnv): string | null {
  const value = env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function readGithubAppId(env: NodeJS.ProcessEnv): string {
  const value = readGithubEnv("GITHUB_APP_ID", env);
  if (!value) {
    throw new Error("GITHUB_APP_ID is required for GitHub App authentication.");
  }
  return value;
}

function readGithubPrivateKey(env: NodeJS.ProcessEnv): string {
  const inline = readGithubEnv("GITHUB_APP_PRIVATE_KEY", env);
  if (inline) {
    return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  }

  const explicitPath = readGithubEnv("GITHUB_APP_PRIVATE_KEY_FILE", env);
  if (explicitPath) {
    const absolutePath = path.resolve(process.cwd(), explicitPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`GitHub App private key file not found: ${absolutePath}`);
    }
    return fs.readFileSync(absolutePath, "utf8");
  }

  throw new Error("GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_FILE is required for GitHub App authentication.");
}

export function parseGithubRepoLocation(location: string): { owner: string; repo: string } {
  let url: URL;
  try {
    if (/^[^/]+@github\.com:/i.test(location)) {
      url = new URL(`ssh://${location.replace(":", "/")}`);
    } else {
      url = new URL(location);
    }
  } catch {
    throw new Error(`Invalid GitHub repository URL: ${location}`);
  }
  if (url.hostname !== "github.com") {
    throw new Error(`Unsupported GitHub repository URL: ${location}`);
  }
  const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length < 2 || !segments[0] || !segments[1]) {
    throw new Error(`Invalid GitHub repository URL: ${location}`);
  }
  return {
    owner: segments[0],
    repo: segments[1].replace(/\.git$/i, ""),
  };
}

export async function createGithubAppJwt(
  nowSeconds = Math.floor(Date.now() / 1000),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const privateKey = crypto.createPrivateKey({
    key: readGithubPrivateKey(env),
    format: "pem",
  });
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt(nowSeconds - 60)
    .setExpirationTime(nowSeconds + 9 * 60)
    .setIssuer(readGithubAppId(env))
    .sign(privateKey);
}

export async function createGithubInstallationAccessToken(
  installationId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const jwt = await createGithubAppJwt(undefined, env);
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      "user-agent": "SpecLens/0.4.0",
      "x-github-api-version": "2022-11-28",
    },
    body: "{}",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await response.text() || `GitHub installation access token request failed for ${installationId}.`);
  }
  const payload = await response.json() as { token?: string };
  if (!payload.token) {
    throw new Error(`GitHub installation ${installationId} did not return an access token.`);
  }
  return payload.token;
}

function appendGitConfigEntries(
  baseEnv: NodeJS.ProcessEnv,
  entries: Array<{ key: string; value: string }>,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...baseEnv };
  const existingCount = Number.parseInt(baseEnv.GIT_CONFIG_COUNT ?? "", 10);
  const startIndex = Number.isFinite(existingCount) && existingCount >= 0 ? existingCount : 0;
  nextEnv.GIT_CONFIG_COUNT = String(startIndex + entries.length);
  entries.forEach((entry, index) => {
    const envIndex = startIndex + index;
    nextEnv[`GIT_CONFIG_KEY_${envIndex}`] = entry.key;
    nextEnv[`GIT_CONFIG_VALUE_${envIndex}`] = entry.value;
  });
  return nextEnv;
}

export function createGithubCloneUrl(
  repoLocation: string,
): string {
  const { owner, repo } = parseGithubRepoLocation(repoLocation);
  return `https://github.com/${owner}/${repo}.git`;
}

export async function createGithubGitAuthEnv(
  installationId: string,
  options: {
    baseEnv?: NodeJS.ProcessEnv;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<NodeJS.ProcessEnv> {
  const runtimeEnv = options.env ?? process.env;
  const baseEnv = options.baseEnv ?? runtimeEnv;
  const token = await createGithubInstallationAccessToken(installationId, runtimeEnv);
  const authorization = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return appendGitConfigEntries(baseEnv, [
    {
      key: "http.https://github.com/.extraHeader",
      value: `AUTHORIZATION: basic ${authorization}`,
    },
  ]);
}
