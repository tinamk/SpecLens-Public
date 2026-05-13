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

function runCommandCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      ...options,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", code => {
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve({ stdout: stdoutText, stderr: stderrText });
        return;
      }
      reject(new Error(stderrText.trim() || stdoutText.trim() || `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

let composeCommandPromise = null;

async function resolveComposeCommand(env) {
  if (!composeCommandPromise) {
    composeCommandPromise = (async () => {
      try {
        await runCommandCapture("docker", ["compose", "version"], { env });
        return { command: "docker", argsPrefix: ["compose"] };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Docker Compose v2 was not found.";
        throw new Error(`Docker Compose v2 is required for hosted E2E; docker-compose v1 cannot parse the compose file. ${detail}`);
      }
    })();
  }
  return await composeCommandPromise;
}

async function runCompose(args, options = {}) {
  const compose = await resolveComposeCommand(options.env ?? process.env);
  return await runCommand(compose.command, [...compose.argsPrefix, ...args], options);
}

async function waitForHttp(url, timeoutMs = 180000) {
  const startedAt = Date.now();
  for (;;) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
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

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

async function imageExists(name, env) {
  try {
    await runCommandCapture("docker", ["image", "inspect", name], { env });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  loadDotEnv();

  const testTargets = process.argv.slice(2);
  const playwrightArgs = ["playwright", "test", ...(testTargets.length > 0 ? testTargets : ["tests/e2e"])];
  const runningGithubOnly = testTargets.length > 0 && testTargets.every(target => target.includes("github-local.spec.ts"));

  const skipCompose = process.env.PLAYWRIGHT_SKIP_COMPOSE === "1";
  const shutdownStack = process.env.SPECLENS_E2E_SHUTDOWN_STACK === "1";
  let testsPassed = false;
  const e2ePorts = {
    WEB_PORT: process.env.WEB_PORT ?? "3300",
    API_PORT: process.env.API_PORT ?? "4400",
    KEYCLOAK_PORT: process.env.KEYCLOAK_PORT ?? "58081",
    POSTGRES_PORT: process.env.POSTGRES_PORT ?? "55432",
    MINIO_PORT: process.env.MINIO_PORT ?? "59000",
    MINIO_CONSOLE_PORT: process.env.MINIO_CONSOLE_PORT ?? "59001",
    RUNNER_PORT: process.env.RUNNER_PORT ?? "45510",
    AI_WORKER_PORT: process.env.AI_WORKER_PORT ?? "4520",
  };
  const composeEnv = {
    ...process.env,
    ...e2ePorts,
    SPECLENS_EXPOSE_E2E_TASKS: process.env.SPECLENS_EXPOSE_E2E_TASKS ?? "false",
    LOCAL_AI_WORKER_MAX_CONCURRENCY: process.env.LOCAL_AI_WORKER_MAX_CONCURRENCY ?? "1",
  };
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${e2ePorts.WEB_PORT}`;
  const apiUrl = `http://localhost:${e2ePorts.API_PORT}`;
  const keycloakUrl = `http://localhost:${e2ePorts.KEYCLOAK_PORT}`;
  const runnerUrl = `http://localhost:${e2ePorts.RUNNER_PORT}`;
  const aiWorkerUrl = `http://localhost:${e2ePorts.AI_WORKER_PORT}`;

  if (runningGithubOnly) {
    requireEnv("E2E_GITHUB_INSTALLATION_ID");
    requireEnv("E2E_GITHUB_PRIVATE_REPO_URL");
    requireEnv("E2E_GITHUB_PRIVATE_REPO_FULL_NAME");
  }

  try {
    if (!skipCompose) {
      const forceBuild = process.env.SPECLENS_E2E_BUILD_IMAGES === "1";
      const resetStack = process.env.SPECLENS_E2E_RESET_STACK === "1";
      const hasRunnerImage = await imageExists("speclens/analysis-runner:local", composeEnv);
      const hasAiWorkerImage = await imageExists("speclens/ai-worker:local", composeEnv);
      const composeUpArgs = forceBuild || !hasRunnerImage || !hasAiWorkerImage
        ? ["up", "-d", "--build"]
        : ["up", "-d"];
      if (resetStack) {
        await runCompose(["down", "-v", "--remove-orphans"], { env: composeEnv }).catch(() => undefined);
      }
      await runCompose(composeUpArgs, { env: composeEnv });
      await waitForHttp(`${keycloakUrl}/realms/speclens/.well-known/openid-configuration`);
      await runCommand("npm", ["run", "seed:keycloak-users"], {
        env: {
          ...composeEnv,
          KEYCLOAK_ADMIN_URL: process.env.KEYCLOAK_ADMIN_URL ?? keycloakUrl,
          KEYCLOAK_ISSUER_URL: process.env.KEYCLOAK_ISSUER_URL ?? `${keycloakUrl}/realms/speclens`,
          KEYCLOAK_ADMIN: process.env.KEYCLOAK_ADMIN ?? "admin",
          KEYCLOAK_ADMIN_PASSWORD: process.env.KEYCLOAK_ADMIN_PASSWORD ?? "admin",
        },
      });
      await waitForHttp(`${apiUrl}/health`);
      await waitForHttp(`${runnerUrl}/health`);
      await waitForHttp(`${aiWorkerUrl}/health`);
      await waitForHttp(`${baseUrl}/`);
    }

    await runCommand("npx", playwrightArgs, {
      env: {
        ...composeEnv,
        PLAYWRIGHT_BASE_URL: baseUrl,
        DATABASE_URL: process.env.DATABASE_URL ?? `postgresql://postgres:postgres@127.0.0.1:${e2ePorts.POSTGRES_PORT}/speclens`,
      },
    });
    testsPassed = true;
  } finally {
    if (!skipCompose && testsPassed && shutdownStack) {
      await runCompose(["down", "--remove-orphans"], { env: composeEnv }).catch(() => undefined);
    }
  }
}

void main().catch(error => {
  console.error("[e2e:hosted] failed", error);
  process.exitCode = 1;
});
