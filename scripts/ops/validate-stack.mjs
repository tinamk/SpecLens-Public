import fs from "node:fs";
import { spawn } from "node:child_process";

function loadDotEnv(filePath = ".env") {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const envText = fs.readFileSync(filePath, "utf8");
  for (const rawLine of envText.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) {
      continue;
    }
    const separatorIndex = rawLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function waitForHttp(url, timeoutMs = 180000) {
  const startedAt = Date.now();
  for (;;) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok || response.status < 500) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${url}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function waitForPortalAuthRedirect(appUrl, timeoutMs = 180000) {
  const startedAt = Date.now();
  const target = `${appUrl}/portal/workspaces`;
  for (;;) {
    try {
      const response = await fetch(target, {
        cache: "no-store",
        redirect: "manual",
        headers: {
          accept: "text/html",
        },
      });
      const location = response.headers.get("location") ?? "";
      if (response.status === 307 && location.includes("/api/auth/login")) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for portal auth redirect at ${target}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

loadDotEnv();

const composeEnv = {
  ...process.env,
  CADDY_HTTP_PORT: process.env.CADDY_HTTP_PORT ?? "8080",
  WEB_PORT: process.env.WEB_PORT ?? "3000",
  API_PORT: process.env.API_PORT ?? "4000",
  KEYCLOAK_PORT: process.env.KEYCLOAK_PORT ?? "8081",
  POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5432",
  MINIO_PORT: process.env.MINIO_PORT ?? "9000",
  MINIO_CONSOLE_PORT: process.env.MINIO_CONSOLE_PORT ?? "9001",
  RUNNER_PORT: process.env.RUNNER_PORT ?? "4510",
  AI_WORKER_PORT: process.env.AI_WORKER_PORT ?? "4520",
  SPECLENS_EXPOSE_E2E_TASKS: process.env.SPECLENS_EXPOSE_E2E_TASKS ?? "true",
  LOCAL_AI_WORKER_MAX_CONCURRENCY: process.env.LOCAL_AI_WORKER_MAX_CONCURRENCY ?? "1",
};

const appUrl = process.env.STACK_VALIDATE_APP_URL ?? `http://localhost:${composeEnv.CADDY_HTTP_PORT}`;
const apiUrl = process.env.STACK_VALIDATE_API_URL ?? `http://localhost:${composeEnv.API_PORT}`;
const runnerUrl = process.env.STACK_VALIDATE_RUNNER_URL ?? `http://localhost:${composeEnv.RUNNER_PORT}`;
const aiWorkerUrl = process.env.STACK_VALIDATE_AI_WORKER_URL ?? `http://localhost:${composeEnv.AI_WORKER_PORT}`;
const keycloakPublicBaseUrl = process.env.STACK_VALIDATE_KEYCLOAK_BASE_URL ?? appUrl;
const keycloakAdminUrl = process.env.STACK_VALIDATE_KEYCLOAK_ADMIN_URL ?? `http://localhost:${composeEnv.KEYCLOAK_PORT}`;
const keycloakIssuerUrl = process.env.STACK_VALIDATE_KEYCLOAK_ISSUER_URL ?? `${keycloakPublicBaseUrl}/auth/realms/speclens`;

const shutdownStack = process.env.STACK_VALIDATE_SHUTDOWN_STACK === "1";
const buildStack = process.env.STACK_VALIDATE_BUILD !== "0";
const githubLocalConfigured = Boolean(process.env.E2E_GITHUB_INSTALLATION_ID?.trim());

try {
  await runCommand("docker", buildStack ? ["compose", "up", "-d", "--build"] : ["compose", "up", "-d"], {
    env: composeEnv,
  });
  await waitForHttp(`${keycloakIssuerUrl}/.well-known/openid-configuration`);
  await runCommand("npm", ["run", "seed:keycloak-users"], {
    env: {
      ...composeEnv,
      APP_URL: appUrl,
      PLAYWRIGHT_BASE_URL: appUrl,
      KEYCLOAK_BASE_URL: keycloakPublicBaseUrl,
      KEYCLOAK_ADMIN_URL: keycloakAdminUrl,
      KEYCLOAK_ISSUER_URL: keycloakIssuerUrl,
      KEYCLOAK_ADMIN: process.env.KEYCLOAK_ADMIN ?? "admin",
      KEYCLOAK_ADMIN_PASSWORD: process.env.KEYCLOAK_ADMIN_PASSWORD ?? "admin",
    },
  });

  await waitForHttp(`${apiUrl}/health`);
  await waitForHttp(`${runnerUrl}/health`);
  await waitForHttp(`${aiWorkerUrl}/health`);
  await waitForHttp(`${appUrl}/`);
  await waitForPortalAuthRedirect(appUrl);

  await runCommand("npm", ["run", "ops:validate"], {
    env: {
      ...composeEnv,
      APP_URL: appUrl,
      API_URL: apiUrl,
      RUNNER_URL: runnerUrl,
      AI_WORKER_URL: aiWorkerUrl,
      KEYCLOAK_ISSUER_URL: keycloakIssuerUrl,
      DATABASE_URL: process.env.DATABASE_URL ?? `postgresql://postgres:postgres@localhost:${composeEnv.POSTGRES_PORT}/speclens`,
      OBJECT_STORAGE_PROVIDER: process.env.OBJECT_STORAGE_PROVIDER ?? "s3-compatible",
      OBJECT_STORAGE_BUCKET: process.env.OBJECT_STORAGE_BUCKET ?? "speclens-artifacts",
      OBJECT_STORAGE_ENDPOINT: process.env.OBJECT_STORAGE_ENDPOINT ?? `http://localhost:${composeEnv.MINIO_PORT}`,
      OBJECT_STORAGE_REGION: process.env.OBJECT_STORAGE_REGION ?? "us-east-1",
      OBJECT_STORAGE_FORCE_PATH_STYLE: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE ?? "true",
      OBJECT_STORAGE_ACCESS_KEY_ID: process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? "minioadmin",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "minioadmin",
    },
  });

  const specs = [
    "tests/e2e/public-site.spec.ts",
    "tests/e2e/auth.spec.ts",
    "tests/e2e/workspace-core.spec.ts",
    "tests/e2e/workspace-settings.spec.ts",
    "tests/e2e/remediation-local.spec.ts",
    "tests/e2e/admin-local.spec.ts",
    ...(githubLocalConfigured ? ["tests/e2e/github-local.spec.ts"] : []),
  ];

  if (!githubLocalConfigured) {
    console.log("[stack] github-local.spec.ts skipped (set E2E_GITHUB_INSTALLATION_ID to enable private GitHub validation)");
  }

  await runCommand("npx", [
    "playwright",
    "test",
    ...specs,
  ], {
    env: {
      ...composeEnv,
      E2E_ENV: "local",
      PLAYWRIGHT_SKIP_COMPOSE: "1",
      PLAYWRIGHT_BASE_URL: appUrl,
      KEYCLOAK_BASE_URL: keycloakPublicBaseUrl,
      KEYCLOAK_ISSUER_URL: keycloakIssuerUrl,
    },
  });
} finally {
  if (shutdownStack) {
    await runCommand("docker", ["compose", "down", "--remove-orphans"], {
      env: composeEnv,
    }).catch(() => undefined);
  }
}
